import { createHash } from "node:crypto";

import { normalizeAssetType, parseEcuadorMoney, signalingFromText } from "./normalizer";
import { CookieSession, decodeHtml, ecuadorDate, endOfEcuadorDay, inputValue, stripTags } from "./sourceUtils";
import { AuctionDocument, AuctionSourceAdapter, DiscoveredAuction, ScrapeMetrics } from "./types";

const ORIGIN = "https://remates.funcionjudicial.gob.ec";
const LIST_PATH = "/rematesjudiciales-web/pages/public/filtrando0.jsf";
const DETAIL_PATH = "/rematesjudiciales-web/pages/public/posturas.jsf";
const LIST_URL = `${ORIGIN}${LIST_PATH}`;

type Classification = "urban" | "rural";
type ResultPage = { auctions: DiscoveredAuction[]; totalPages: number };

const ajaxHeaders = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "Faces-Request": "partial/ajax", "X-Requested-With": "XMLHttpRequest", Referer: LIST_URL };

const xmlUpdate = (xml: string, id: string) => decodeHtml(xml.match(new RegExp(`<update id="${id.replace(/:/g, "\\:")}"><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/update>`))?.[1] || "");
const xmlViewState = (xml: string, fallback: string) => xml.match(/<update id="(?:[^" ]*javax\.faces\.)?ViewState"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/)?.[1] || fallback;

const rowCell = (row: string, suffix: string) => stripTags(row.match(new RegExp(`<td[^>]+id="tablaResultados:\\d+:${suffix}"[^>]*>([\\s\\S]*?)<\\/td>`, "i"))?.[1] || "");

export const parseCjResults = (html: string, classification: Classification, page: number): ResultPage => {
  const safe = html.replace(/data:image\/[^"']+/gi, "");
  const auctions: DiscoveredAuction[] = [];
  const rows = [...safe.matchAll(/<tr id="tablaResultados:(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const rowMatch of rows) {
    const rowIndex = Number(rowMatch[1]);
    const row = rowMatch[2];
    const officialAuctionId = row.match(/EC-RJ-\d+/)?.[0];
    if (!officialAuctionId) continue;
    const auctionDateRaw = rowCell(row, "j_idt679");
    const startAt = ecuadorDate(auctionDateRaw);
    const locationHtml = row.match(/<td[^>]+id="tablaResultados:\d+:j_idt682"[^>]*>([\s\S]*?)<\/td>/i)?.[1] || "";
    const [province, canton] = locationHtml.split(/<br\s*\/?\s*>/i).map(stripTags);
    const type = rowCell(row, "j_idt687");
    const signalingRaw = rowCell(row, "j_idt693");
    const appraisalRaw = rowCell(row, "j_idt696");
    const calculatedRaw = rowCell(row, "j_idt699");
    auctions.push({
      source: "CJ",
      sourceAuctionId: `CJ-${officialAuctionId}`,
      coactiveProcessNumber: null,
      assetType: normalizeAssetType(type),
      appraisalValue: parseEcuadorMoney(appraisalRaw),
      office: "Consejo de la Judicatura",
      legalFramework: null,
      publicationStartAt: startAt,
      publicationEndAt: endOfEcuadorDay(startAt),
      listingStatus: "En difusión",
      listingSignalingNumber: signalingFromText(signalingRaw),
      imageUrls: [],
      officialListingUrl: LIST_URL,
      officialDocumentUrl: null,
      downloadControl: "btnInformePericial",
      detailControl: `tablaResultados:${rowIndex}:j_idt673`,
      rawListingData: {
        officialAuctionId, classification, page, rowIndex, province, canton, type,
        auctionDateRaw, signalingRaw, appraisalRaw, calculatedRaw,
        calculatedBaseValue: parseEcuadorMoney(calculatedRaw.match(/[\d,.]+/)?.[0] || null),
      },
    });
  }
  const pages = [...safe.matchAll(/tablaResultados:down_ds_(\d+)/g)].map((item) => Number(item[1]));
  return { auctions, totalPages: Math.max(1, ...pages) };
};

class CjPortalSession {
  private readonly http = new CookieSession();
  private viewState = "";
  private classification: Classification = "urban";
  private html = "";
  private page = 1;

  private async click(control: string, extra: Record<string, string> = {}) {
    const body = new URLSearchParams({
      formFiltrado: "formFiltrado",
      "javax.faces.ViewState": this.viewState,
      "javax.faces.source": control,
      "javax.faces.partial.event": "click",
      "javax.faces.partial.execute": `${control} @component`,
      "javax.faces.partial.render": "@component",
      "org.richfaces.ajax.component": control,
      [control]: control,
      rfExt: "null",
      "AJAX:EVENTS_COUNT": "1",
      "javax.faces.partial.ajax": "true",
      ...extra,
    });
    const response = await this.http.request(LIST_URL, { method: "POST", headers: ajaxHeaders, body });
    if (!response.ok) throw new Error(`Judicatura AJAX returned HTTP ${response.status}.`);
    const xml = await response.text();
    this.viewState = xmlViewState(xml, this.viewState);
    return xml;
  }

  async open(classification: Classification) {
    this.classification = classification;
    const response = await this.http.request(LIST_URL);
    if (!response.ok) throw new Error(`Judicatura returned HTTP ${response.status}.`);
    const initial = await response.text();
    this.viewState = inputValue(initial, "javax.faces.ViewState");
    if (!this.viewState) throw new Error("Judicatura did not expose JSF ViewState.");
    await this.click("calendarIconPrincipal11");
    await this.click("j_idt487:1:j_idt490");
    const classificationControl = classification === "urban" ? "tablaTipoBienClasificacion:0:j_idt513" : "tablaTipoBienClasificacion:1:j_idt513";
    const xml = await this.click(classificationControl);
    this.html = xmlUpdate(xml, "pnlF") || xml;
    this.page = 1;
    return parseCjResults(this.html, classification, this.page);
  }

  async goToPage(page: number) {
    const xml = await this.click("tablaResultados:down", { "tablaResultados:down:page": String(page) });
    this.html = xmlUpdate(xml, "tablaResultados") || xmlUpdate(xml, "pnlF") || xml;
    this.page = page;
    return parseCjResults(this.html, this.classification, page);
  }

  async openDetail(auction: DiscoveredAuction) {
    const control = auction.detailControl;
    if (!control) throw new Error(`Judicatura auction ${auction.sourceAuctionId} has no detail control.`);
    const classValue = this.classification === "urban" ? "263" : "264";
    const body = new URLSearchParams({
      formFiltrado: "formFiltrado", j_idt711: "", j_idt719: "2", j_idt723: classValue, j_idt727: "",
      fechRemateInputDate: "", fechRemateInputCurrentDate: new Date().toLocaleDateString("en-CA", { month: "2-digit", year: "numeric" }).replace("-", "/"),
      "javax.faces.ViewState": this.viewState,
      "javax.faces.source": control, "javax.faces.partial.event": "click",
      "javax.faces.partial.execute": `${control} @component`, "javax.faces.partial.render": "@component",
      "org.richfaces.ajax.component": control, [control]: control, rfExt: "null", "AJAX:EVENTS_COUNT": "1", "javax.faces.partial.ajax": "true",
    });
    const response = await this.http.request(LIST_URL, { method: "POST", headers: ajaxHeaders, body });
    const xml = await response.text();
    if (!response.ok || !xml.includes("<redirect")) throw new Error(`Judicatura did not open detail for ${auction.sourceAuctionId}.`);
    const detailResponse = await this.http.request(`${ORIGIN}${DETAIL_PATH}`);
    if (!detailResponse.ok) throw new Error(`Judicatura detail returned HTTP ${detailResponse.status}.`);
    return detailResponse.text();
  }

  async downloadInforme(detailHtml: string, auction: DiscoveredAuction) {
    const viewState = inputValue(detailHtml, "javax.faces.ViewState");
    const response = await this.http.request(`${ORIGIN}${DETAIL_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: `${ORIGIN}${DETAIL_PATH}` },
      body: new URLSearchParams({ j_idt28: "j_idt28", btnInformePericial: "btnInformePericial", "javax.faces.ViewState": viewState }),
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (!response.ok || body.subarray(0, 4).toString() !== "%PDF") throw new Error(`Judicatura did not return the informe pericial for ${auction.sourceAuctionId}.`);
    return { auction, body, contentType: response.headers.get("content-type") || "application/pdf", filename: `${auction.sourceAuctionId}-informe-pericial.pdf`, sha256: createHash("sha256").update(body).digest("hex") } satisfies AuctionDocument;
  }
}

const detailValue = (html: string, label: string) => {
  const normalizedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`<span[^>]*>\\s*${normalizedLabel}\\s*<\\/span>[\\s\\S]{0,300}?<span[^>]*>([\\s\\S]*?)<\\/span>`, "i"));
  return match ? stripTags(match[1]) : null;
};

const enrichFromDetail = (auction: DiscoveredAuction, html: string): DiscoveredAuction => {
  const process = html.match(/No\. Proceso:[\s\S]{0,400}?<span[^>]*>(\d+)<\/span>/i)?.[1] || null;
  const startRaw = detailValue(html, "Fecha de Inicio de Posturas:");
  const endRaw = detailValue(html, "Fecha de Fin de Posturas:");
  const location = detailValue(html, "Localización del Bien:")?.split(",").map((item) => item.trim()) || [];
  const description = html.match(/Descripción[\s\S]*?<div[^>]+ui-fieldset-content[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  return {
    ...auction,
    coactiveProcessNumber: process,
    publicationStartAt: ecuadorDate(startRaw) || auction.publicationStartAt,
    publicationEndAt: ecuadorDate(endRaw) || auction.publicationEndAt,
    rawListingData: {
      ...auction.rawListingData,
      province: location[0] || auction.rawListingData.province,
      canton: location[1] || auction.rawListingData.canton,
      sector: detailValue(html, "Sector:"),
      startRaw, endRaw, description: description ? stripTags(description) : null,
    },
  };
};

const findAuction = async (auction: DiscoveredAuction) => {
  const classification = String(auction.rawListingData.classification) as Classification;
  const targetOfficialId = String(auction.rawListingData.officialAuctionId);
  const session = new CjPortalSession();
  let result = await session.open(classification);
  for (let page = 1; page <= result.totalPages; page += 1) {
    if (page > 1) result = await session.goToPage(page);
    const target = result.auctions.find((item) => item.rawListingData.officialAuctionId === targetOfficialId);
    if (target) return { session, target };
  }
  throw new Error(`Judicatura auction ${auction.sourceAuctionId} was not found.`);
};

export const scrapeCj = async ({
  maxPages = Number(process.env.REMATES_CJ_MAX_PAGES || 5), shouldDownload = () => false, maxDocuments = Number.POSITIVE_INFINITY,
}: { maxPages?: number; shouldDownload?: (auction: DiscoveredAuction) => boolean | Promise<boolean>; maxDocuments?: number } = {}) => {
  const auctions: DiscoveredAuction[] = [];
  const documents: AuctionDocument[] = [];
  const metrics: ScrapeMetrics = { source: "CJ", pagesVisited: 0, itemsDiscovered: 0, uniqueItems: 0, emptyPages: 0, duplicatePages: 0, documentsDownloaded: 0, documentsReused: 0, errors: [] };
  for (const classification of ["urban", "rural"] as const) {
    const session = new CjPortalSession();
    let result = await session.open(classification);
    const pageLimit = Math.min(maxPages, result.totalPages);
    for (let page = 1; page <= pageLimit; page += 1) {
      if (page > 1) result = await session.goToPage(page);
      metrics.pagesVisited += 1;
      metrics.itemsDiscovered += result.auctions.length;
      if (!result.auctions.length) { metrics.emptyPages += 1; break; }
      auctions.push(...result.auctions);
    }
  }
  const unique = [...new Map(auctions.map((item) => [item.sourceAuctionId, item])).values()];
  metrics.uniqueItems = unique.length;
  for (const auction of unique) {
    if (documents.length >= maxDocuments || !(await shouldDownload(auction))) continue;
    try {
      const { session, target } = await findAuction(auction);
      const detailHtml = await session.openDetail(target);
      const enriched = enrichFromDetail(target, detailHtml);
      documents.push(await session.downloadInforme(detailHtml, enriched));
      metrics.documentsDownloaded += 1;
    } catch (error) {
      metrics.errors.push({ itemId: auction.sourceAuctionId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { auctions: unique, documents, metrics };
};

export class CjAdapter implements AuctionSourceAdapter {
  readonly source = "CJ";
  async discoverAuctions() { return (await scrapeCj()).auctions; }
  async fetchAuctionDetail(auction: DiscoveredAuction) {
    const { session, target } = await findAuction(auction);
    return enrichFromDetail(target, await session.openDetail(target));
  }
  async downloadDocuments(auction: DiscoveredAuction) {
    const { session, target } = await findAuction(auction);
    const detailHtml = await session.openDetail(target);
    const enriched = enrichFromDetail(target, detailHtml);
    return [await session.downloadInforme(detailHtml, enriched)];
  }
}
