import { createHash } from "node:crypto";

import { normalizeAssetType, parseEcuadorMoney } from "./normalizer";
import { CookieSession, decodeHtml, ecuadorDate, endOfEcuadorDay, inputValue, stripTags } from "./sourceUtils";
import { AuctionDocument, AuctionSource, AuctionSourceAdapter, DiscoveredAuction, ScrapeMetrics } from "./types";

const ORIGIN = "https://remates.cfn.fin.ec";
const ROOT_PATH = "/cfn-application-portal-remate-web/";
const INDEX_URL = `${ORIGIN}${ROOT_PATH}pages/index.xhtml`;
const DETAIL_URL = `${ORIGIN}${ROOT_PATH}pages/detalleBien.xhtml`;
const LIST_URL = `${ORIGIN}${ROOT_PATH}`;
const PROPERTY_WORDS = /\b(inmueble|lote|terreno|solar|casa|vivienda|departamento|apartamento|oficina|local|edificio|hacienda|finca|predio|bodega|galp[oó]n)\b/i;

const sourceForCode = (code: string): AuctionSource => code === "01" ? "CFN" : code === "02" ? "BANCO_PACIFICO" : "BANECUADOR";
const monthName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");

export const parseCfnCarousel = (html: string): DiscoveredAuction[] => {
  const auctions: DiscoveredAuction[] = [];
  const starts = [...html.matchAll(/<div id="carouselSlider:(\d+):j_id_x"/g)];
  for (let position = 0; position < starts.length; position += 1) {
    const match = starts[position];
    const index = Number(match[1]);
    const end = starts[position + 1]?.index ?? html.indexOf("</div><script id=\"carouselSlider_s\"", match.index);
    const card = html.slice(match.index, end > match.index! ? end : match.index! + 15_000);
    const description = stripTags(card.match(/ui-tooltip-text[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "").replace(/\.{3}\s*Enterate[\s\S]*$/i, "").trim();
    if (!PROPERTY_WORDS.test(description)) continue;
    const institutionCode = card.match(/imagen\?cod_emp=(\d+)/i)?.[1] || "01";
    const source = sourceForCode(institutionCode);
    const officialAuctionId = stripTags(card.match(/Número de Remate[\s\S]*?font-size:\s*25px[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    if (!officialAuctionId) continue;
    const appraisalRaw = stripTags(card.match(/Valor del Aval[uú]o[\s\S]*?font-size:\s*35px;\s*color:white[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const imagePath = decodeHtml(card.match(/<img[^>]+src="([^"]*imagen\?cod_emp=\d+&amp;image_id=[^"]+)"/i)?.[1] || "");
    const dateSection = card.slice(card.indexOf("Fecha del Remate"));
    const dateMatch = dateSection.match(/<p[^>]*>\s*(\d{1,2})\s*<em[^>]*>([^<]+)<\/em>/i);
    const dateRaw = dateMatch ? `${dateMatch[1]} de ${monthName(dateMatch[2])} de ${new Date().getFullYear()}` : null;
    const startAt = ecuadorDate(dateRaw);
    auctions.push({
      source,
      sourceAuctionId: `${source}-${officialAuctionId.replace(/\s+/g, "-")}`,
      coactiveProcessNumber: officialAuctionId,
      assetType: normalizeAssetType(description),
      appraisalValue: parseEcuadorMoney(appraisalRaw),
      office: source === "CFN" ? "Corporación Financiera Nacional" : source === "BANCO_PACIFICO" ? "Banco del Pacífico" : "BanEcuador",
      legalFramework: null,
      publicationStartAt: startAt,
      publicationEndAt: endOfEcuadorDay(startAt),
      listingStatus: "Publicado",
      listingSignalingNumber: null,
      imageUrls: imagePath ? [new URL(imagePath, ORIGIN).toString()] : [],
      officialListingUrl: LIST_URL,
      officialDocumentUrl: null,
      downloadControl: `carouselSlider:${index}:j_id_2v`,
      detailControl: `carouselSlider:${index}:j_id_2v`,
      rawListingData: { index, institutionCode, officialAuctionId, description, appraisalRaw, dateRaw },
    });
  }
  return [...new Map(auctions.map((item) => [item.sourceAuctionId, item])).values()];
};

class CfnPortalSession {
  private readonly http = new CookieSession();
  private viewState = "";
  private html = "";

  async open() {
    const response = await this.http.request(LIST_URL);
    if (!response.ok) throw new Error(`CFN portal returned HTTP ${response.status}.`);
    this.html = await response.text();
    this.viewState = inputValue(this.html, "javax.faces.ViewState");
    if (!this.viewState) throw new Error("CFN portal did not expose JSF ViewState.");
    return parseCfnCarousel(this.html);
  }

  async detail(auction: DiscoveredAuction) {
    const control = auction.detailControl;
    if (!control) throw new Error(`CFN auction ${auction.sourceAuctionId} has no detail control.`);
    const response = await this.http.request(INDEX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Faces-Request": "partial/ajax", "X-Requested-With": "XMLHttpRequest", Referer: LIST_URL },
      body: new URLSearchParams({
        "javax.faces.partial.ajax": "true", "javax.faces.source": control,
        "javax.faces.partial.execute": control, [control]: control, "javax.faces.ViewState": this.viewState,
      }),
    });
    const xml = await response.text();
    if (!response.ok || !xml.includes("<redirect")) throw new Error(`CFN portal did not open detail for ${auction.sourceAuctionId}.`);
    const detail = await this.http.request(DETAIL_URL);
    if (!detail.ok) throw new Error(`CFN detail returned HTTP ${detail.status}.`);
    return detail.text();
  }

  async document(url: string, auction: DiscoveredAuction) {
    const response = await this.http.request(url, { headers: { Referer: DETAIL_URL } });
    const body = Buffer.from(await response.arrayBuffer());
    if (!response.ok || body.subarray(0, 4).toString() !== "%PDF") throw new Error(`CFN portal did not return a PDF for ${auction.sourceAuctionId}.`);
    return { auction, body, contentType: response.headers.get("content-type") || "application/pdf", filename: `${auction.sourceAuctionId}-informe-pericial.pdf`, sha256: createHash("sha256").update(body).digest("hex") } satisfies AuctionDocument;
  }
}

const detailField = (html: string, label: string) => {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<span[^>]*>\\s*${escaped}\\s*<\\/span><\\/div><div[^>]*><span[^>]*>([\\s\\S]*?)<\\/span>`, "i"));
  return match ? stripTags(match[1]) : null;
};

const parseDetail = (auction: DiscoveredAuction, html: string) => {
  const type = stripTags(html.match(/Tipo de Bien:[\s\S]{0,250}?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
  if (type && type.toUpperCase() !== "INMUEBLE") throw new Error(`${auction.sourceAuctionId} is ${type}, not real estate.`);
  const description = stripTags(html.match(/Descripción del Bien[\s\S]*?<div class="ui-fieldset-content"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)?.[1] || String(auction.rawListingData.description || ""));
  const startRaw = detailField(html, "Fecha del Remate:");
  const endRaw = detailField(html, "Fecha Fin de Remate:");
  const institutionCode = String(auction.rawListingData.institutionCode || "01");
  const images = [...html.matchAll(/src="([^"]*imagen\?cod_emp=\d+&amp;image_id=[^"]+)"/gi)].map((item) => new URL(decodeHtml(item[1]), ORIGIN).toString());
  const form = html.match(/<form id="formInfPeriDialog"[\s\S]*?<\/form>/i)?.[0] || html.match(/<form id="formProvDialog"[\s\S]*?<\/form>/i)?.[0] || "";
  const documentPath = decodeHtml(form.match(/data="([^"]*pdf_id=[^"]+)"/i)?.[1] || "");
  const documentUrl = documentPath ? new URL(documentPath, ORIGIN).toString() : null;
  return {
    auction: {
      ...auction,
      assetType: normalizeAssetType(description),
      publicationStartAt: ecuadorDate(startRaw) || auction.publicationStartAt,
      publicationEndAt: ecuadorDate(endRaw) || auction.publicationEndAt,
      imageUrls: [...new Set([...auction.imageUrls, ...images])],
      officialDocumentUrl: documentUrl,
      rawListingData: {
        ...auction.rawListingData, description, province: detailField(html, "Provincia:"), canton: detailField(html, "Canton:"),
        parish: detailField(html, "Parroquia:"), startRaw, endRaw,
        documentDeadlineRaw: detailField(html, "Fecha máxima de entrega de documentos:"),
        allowsFinancing: detailField(html, "Acepta Pago a Plazo")?.toUpperCase() === "SI",
        institutionCode,
      },
    } satisfies DiscoveredAuction,
    documentUrl,
  };
};

const fetchCfnDetail = async (auction: DiscoveredAuction) => {
  const session = new CfnPortalSession();
  const auctions = await session.open();
  const current = auctions.find((item) => item.sourceAuctionId === auction.sourceAuctionId);
  if (!current) throw new Error(`CFN auction ${auction.sourceAuctionId} was not found.`);
  const parsed = parseDetail(current, await session.detail(current));
  return { session, ...parsed };
};

export const scrapeCfn = async ({
  shouldDownload = () => false, maxDocuments = Number.POSITIVE_INFINITY,
}: { shouldDownload?: (auction: DiscoveredAuction) => boolean | Promise<boolean>; maxDocuments?: number } = {}) => {
  const session = new CfnPortalSession();
  const auctions = await session.open();
  const documents: AuctionDocument[] = [];
  const metrics: ScrapeMetrics = { source: "CFN", pagesVisited: 1, itemsDiscovered: auctions.length, uniqueItems: auctions.length, emptyPages: 0, duplicatePages: 0, documentsDownloaded: 0, documentsReused: 0, errors: [] };
  for (const auction of auctions) {
    if (documents.length >= maxDocuments || !(await shouldDownload(auction))) continue;
    try {
      const detailSession = new CfnPortalSession();
      const current = (await detailSession.open()).find((item) => item.sourceAuctionId === auction.sourceAuctionId);
      if (!current) throw new Error(`CFN auction ${auction.sourceAuctionId} disappeared.`);
      const parsed = parseDetail(current, await detailSession.detail(current));
      if (!parsed.documentUrl) throw new Error(`CFN auction ${auction.sourceAuctionId} has no official PDF.`);
      documents.push(await detailSession.document(parsed.documentUrl, parsed.auction));
      metrics.documentsDownloaded += 1;
    } catch (error) {
      metrics.errors.push({ itemId: auction.sourceAuctionId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { auctions, documents, metrics };
};

export class CfnAdapter implements AuctionSourceAdapter {
  readonly source = "CFN";
  async discoverAuctions() { return (await scrapeCfn()).auctions; }
  async fetchAuctionDetail(auction: DiscoveredAuction) { return (await fetchCfnDetail(auction)).auction; }
  async downloadDocuments(auction: DiscoveredAuction) {
    const parsed = await fetchCfnDetail(auction);
    if (!parsed.documentUrl) return [];
    return [await parsed.session.document(parsed.documentUrl, parsed.auction)];
  }
}
