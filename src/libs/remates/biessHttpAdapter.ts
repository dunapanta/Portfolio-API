import { createHash } from "node:crypto";

import { normalizeAssetType, parseEcuadorMoney, shouldStopPagination, signalingFromText } from "./normalizer";
import {
  AuctionDocument,
  AuctionSourceAdapter,
  DiscoveredAuction,
  ScrapeMetrics,
} from "./types";

const ORIGIN = "https://rematevirtual.biess.fin.ec";
const PORTAL_PATH = "/subasta_prendarios_web/web/portal_remate.xhtml";
const DEFAULT_OFFICES = [15, 16];
const ROWS = 6;

const decodeHtml = (value: string) => value
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));

const stripTags = (value: string) => decodeHtml(value.replace(/<[^>]+>/g, " "))
  .replace(/\s+/g, " ")
  .trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const inputValue = (html: string, name: string) => {
  const escaped = escapeRegExp(name);
  return decodeHtml(html.match(new RegExp(`name=["']${escaped}["'][^>]*value=["']([^"']*)`, "i"))?.[1] || "");
};

const fieldValue = (html: string, label: string) => {
  const escaped = escapeRegExp(label);
  const match = html.match(new RegExp(`<label[^>]*>\\s*${escaped}:?\\s*</label>[\\s\\S]*?<span[^>]*>([\\s\\S]*?)</span>`, "i"));
  return match ? stripTags(match[1]) : null;
};

const ecuadorDate = (value: string | null) => {
  if (!value) return null;
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const [, day, month, year, hour = "00", minute = "00", second = "00"] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}-05:00`;
};

const officeIdFor = (auction: DiscoveredAuction) =>
  auction.sourceAuctionId.includes("-GYE-") || auction.office?.toUpperCase().includes("GUAYAQUIL") ? 16 : 15;

const parseFilename = (header: string | null, fallback: string) => {
  if (!header) return fallback;
  const utf8 = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const simple = header.match(/filename="?([^";]+)"?/i)?.[1];
  const value = utf8 || simple;
  if (!value) return fallback;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

class CookieSession {
  private readonly cookies = new Map<string, string>();

  async request(url: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookies.size) {
      headers.set("Cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    }
    const response = await fetch(url, { ...init, headers });
    const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
    return response;
  }
}

type PageCard = DiscoveredAuction & { downloadControl: string; detailControl: string };

const parseCards = (html: string, officialListingUrl: string): PageCard[] => {
  const cards: PageCard[] = [];
  const pattern = /<div id="formPortalId:bienesId:(\d+):j_idt85"[\s\S]*?<script id="formPortalId:bienesId:\1:j_idt85_s"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const index = match[1];
    const card = match[0];
    const sourceAuctionId = card.match(/BIESS-[A-Z]+-\d{4}-\d{4}/)?.[0];
    if (!sourceAuctionId) continue;
    const process = stripTags(card.match(/ui-panel-title">([\s\S]*?)<\/span>/i)?.[1] || "")
      .replace(/^Procedimiento coactivo Nro:\s*/i, "") || null;
    const rawType = fieldValue(card, "Tipo de Bien");
    const appraisal = fieldValue(card, "Avaluo Pericial");
    const office = fieldValue(card, "Oficina");
    const legalFramework = fieldValue(card, "Norma Legal");
    const publicationStart = fieldValue(card, "Fecha Inicio Publicación");
    const publicationEnd = fieldValue(card, "Fecha Fin Publicación");
    const listingStatus = fieldValue(card, "Estado");
    const imagePath = decodeHtml(card.match(/src="([^"]*FotografiaBienServlet\?[^"']+)"/i)?.[1] || "");
    cards.push({
      source: "BIESS",
      sourceAuctionId,
      coactiveProcessNumber: process,
      assetType: normalizeAssetType(rawType),
      appraisalValue: parseEcuadorMoney(appraisal),
      office,
      legalFramework,
      publicationStartAt: ecuadorDate(publicationStart),
      publicationEndAt: ecuadorDate(publicationEnd),
      listingStatus,
      listingSignalingNumber: null,
      imageUrls: imagePath ? [new URL(imagePath, ORIGIN).toString()] : [],
      officialListingUrl,
      officialDocumentUrl: null,
      downloadControl: `formPortalId:bienesId:${index}:j_idt108`,
      detailControl: `formPortalId:bienesId:${index}:j_idt89`,
      rawListingData: {
        process,
        assetType: rawType,
        appraisal,
        office,
        legalFramework,
        publicationStart,
        publicationEnd,
        status: listingStatus,
      },
    });
  }
  return cards;
};

class BiessPortalSession {
  private readonly http = new CookieSession();
  private csrf = "";
  private viewState = "";
  private page = 1;
  private html = "";
  readonly officialListingUrl: string;
  private readonly endpoint = `${ORIGIN}${PORTAL_PATH}`;

  constructor(readonly officeId: number) {
    this.officialListingUrl = `${this.endpoint}?oficina=${officeId}`;
  }

  async open() {
    const response = await this.http.request(this.officialListingUrl, {
      headers: { "User-Agent": "RematesEcuador/1.0 (+https://www.dunapant.dev/tools/remates-ecuador)" },
    });
    if (!response.ok) throw new Error(`BIESS returned HTTP ${response.status}.`);
    this.html = await response.text();
    this.csrf = inputValue(this.html, "_csrf");
    this.viewState = inputValue(this.html, "javax.faces.ViewState");
    if (!this.csrf || !this.viewState) throw new Error("BIESS JSF session did not expose CSRF/ViewState.");
    return this.cards();
  }

  cards() {
    return parseCards(this.html, this.officialListingUrl);
  }

  private commonForm() {
    return {
      formPortalId: "formPortalId",
      _csrf: this.csrf,
      "formPortalId:j_idt80_dropdown": "0",
      "formPortalId:j_idt80_mobiledropdown": "0",
      "formPortalId:j_idt80_page": "0",
      "formPortalId:bienesId_rppDD": String(ROWS),
      "javax.faces.ViewState": this.viewState,
    };
  }

  async next() {
    const body = new URLSearchParams({
      ...this.commonForm(),
      "javax.faces.partial.ajax": "true",
      "javax.faces.source": "formPortalId:bienesId",
      "javax.faces.partial.execute": "formPortalId:bienesId",
      "javax.faces.partial.render": "formPortalId:bienesId",
      "formPortalId:bienesId": "formPortalId:bienesId",
      "formPortalId:bienesId_pagination": "true",
      "formPortalId:bienesId_first": String(this.page * ROWS),
      "formPortalId:bienesId_rows": String(ROWS),
    });
    const response = await this.http.request(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Faces-Request": "partial/ajax",
        "X-Requested-With": "XMLHttpRequest",
        Referer: this.officialListingUrl,
      },
      body,
    });
    if (!response.ok) throw new Error(`BIESS pagination returned HTTP ${response.status}.`);
    const xml = await response.text();
    this.html = xml.match(/<update id="formPortalId:bienesId"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/)?.[1] || "";
    this.viewState = xml.match(/<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/)?.[1] || this.viewState;
    this.page += 1;
    return this.cards();
  }

  async download(card: PageCard) {
    const body = new URLSearchParams({
      ...this.commonForm(),
      [card.downloadControl]: card.downloadControl,
    });
    const response = await this.http.request(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: this.officialListingUrl,
      },
      body,
    });
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const documentBody = Buffer.from(await response.arrayBuffer());
    if (!response.ok || documentBody.subarray(0, 4).toString() !== "%PDF") {
      throw new Error(`BIESS did not return a PDF for ${card.sourceAuctionId} (HTTP ${response.status}, ${contentType}).`);
    }
    const filename = parseFilename(response.headers.get("content-disposition"), `${card.sourceAuctionId}.pdf`);
    return {
      auction: card,
      body: documentBody,
      contentType,
      filename,
      sha256: createHash("sha256").update(documentBody).digest("hex"),
    } satisfies AuctionDocument;
  }

  async detail(card: PageCard) {
    const body = new URLSearchParams({
      ...this.commonForm(),
      [card.detailControl]: card.detailControl,
    });
    const response = await this.http.request(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: this.officialListingUrl,
      },
      body,
    });
    if (!response.ok) throw new Error(`BIESS detail returned HTTP ${response.status}.`);
    const detail = await response.text();
    const signalingRaw = fieldValue(detail, "N° Señalamiento") || fieldValue(detail, "Nº Señalamiento");
    const imageUrls = [...detail.matchAll(/src="([^"]*FotografiaBienServlet\?[^"']+)"/gi)]
      .map((item) => new URL(decodeHtml(item[1]), ORIGIN).toString());
    return {
      ...card,
      listingSignalingNumber: signalingFromText(signalingRaw),
      imageUrls: [...new Set([...card.imageUrls, ...imageUrls])],
      rawListingData: { ...card.rawListingData, signaling: signalingRaw },
    };
  }
}

export type BiessScrapeOptions = {
  maxPages?: number;
  offices?: number[];
  shouldDownload?: (auction: DiscoveredAuction) => boolean | Promise<boolean>;
  maxDocuments?: number;
};

export const scrapeBiess = async ({
  maxPages = Number(process.env.MAX_PAGES_PER_SOURCE || 30),
  offices = DEFAULT_OFFICES,
  shouldDownload = () => false,
  maxDocuments = Number.POSITIVE_INFINITY,
}: BiessScrapeOptions = {}) => {
  const auctions: DiscoveredAuction[] = [];
  const documents: AuctionDocument[] = [];
  const seenIds = new Set<string>();
  const metrics: ScrapeMetrics = {
    source: "BIESS",
    pagesVisited: 0,
    itemsDiscovered: 0,
    uniqueItems: 0,
    emptyPages: 0,
    duplicatePages: 0,
    documentsDownloaded: 0,
    documentsReused: 0,
    errors: [],
  };

  for (const officeId of offices) {
    const session = new BiessPortalSession(officeId);
    let cards = await session.open();
    let previousIds: string[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      metrics.pagesVisited += 1;
      const ids = cards.map((item) => item.sourceAuctionId);
      metrics.itemsDiscovered += ids.length;
      const decision = shouldStopPagination({ currentIds: ids, previousIds, seenIds });
      if (decision.stop) {
        if (decision.reason === "empty") metrics.emptyPages += 1;
        else metrics.duplicatePages += 1;
        break;
      }

      for (const card of cards) {
        if (seenIds.has(card.sourceAuctionId)) continue;
        seenIds.add(card.sourceAuctionId);
        auctions.push(card);
        if (documents.length >= maxDocuments || !(await shouldDownload(card))) continue;
        try {
          documents.push(await session.download(card));
          metrics.documentsDownloaded += 1;
        } catch (error) {
          metrics.errors.push({
            itemId: card.sourceAuctionId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      previousIds = ids;
      if (page === maxPages) break;
      cards = await session.next();
    }
  }

  metrics.uniqueItems = seenIds.size;
  return { auctions, documents, metrics };
};

export class BiessHttpAdapter implements AuctionSourceAdapter {
  readonly source = "BIESS";

  async discoverAuctions() {
    return (await scrapeBiess()).auctions;
  }

  async fetchAuctionDetail(auction: DiscoveredAuction) {
    const session = new BiessPortalSession(officeIdFor(auction));
    let cards = await session.open();
    const seen = new Set<string>();
    const maxPages = Number(process.env.MAX_PAGES_PER_SOURCE || 30);
    for (let page = 1; page <= maxPages; page += 1) {
      const target = cards.find((item) => item.sourceAuctionId === auction.sourceAuctionId);
      if (target) return session.detail(target);
      const ids = cards.map((item) => item.sourceAuctionId);
      if (!ids.length || ids.every((id) => seen.has(id))) break;
      ids.forEach((id) => seen.add(id));
      cards = await session.next();
    }
    throw new Error(`BIESS auction ${auction.sourceAuctionId} was not found while fetching its detail.`);
  }

  async downloadDocuments(auction: DiscoveredAuction) {
    const result = await scrapeBiess({
      offices: [officeIdFor(auction)],
      shouldDownload: (item) => item.sourceAuctionId === auction.sourceAuctionId,
      maxDocuments: 1,
    });
    return result.documents.filter((document) => document.auction.sourceAuctionId === auction.sourceAuctionId);
  }
}
