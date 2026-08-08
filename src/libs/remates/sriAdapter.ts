import { createHash } from "node:crypto";

import { normalizeAssetType, parseEcuadorMoney } from "./normalizer";
import { ecuadorDate, endOfEcuadorDay, pdfFilename, stripTags } from "./sourceUtils";
import { AuctionDocument, AuctionSourceAdapter, DiscoveredAuction, ScrapeMetrics } from "./types";

const ORIGIN = "https://www.sri.gob.ec";
const currentPage = () => `${ORIGIN}/remates-y-subastas-${new Date().getFullYear()}`;
const PROPERTY_WORDS = /\b(vivienda|casa|departamento|apartamento|terreno|solar|oficina|bodega|local|edificio|predio|inmueble|hacienda|finca|parqueadero|estacionamiento)\b/i;

const extractNoticeId = (url: string) => {
  const decoded = decodeURIComponent(url);
  return decoded.match(/(?:Nro\.?\s*)?([A-Z]{2,}\d*-[A-Z]+\d*-\d{6,})/i)?.[1]
    || url.match(/descargar\/([0-9a-f-]{36})\//i)?.[1]
    || createHash("sha256").update(url).digest("hex").slice(0, 20);
};

export const parseSriAuctions = (html: string, officialListingUrl: string): DiscoveredAuction[] => {
  const auctions: DiscoveredAuction[] = [];
  const links = [...html.matchAll(/<a[^>]+href=["']([^"']+\.pdf)["'][^>]*>\s*VER\s+AVISO\s+DE\s+REMATE\s*<\/a>/gi)];
  for (const link of links) {
    const before = html.slice(Math.max(0, link.index! - 2_500), link.index);
    const titleMatches = [...before.matchAll(/<p[^>]*>\s*<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>\s*<\/p>/gi)];
    const title = stripTags(titleMatches.at(-1)?.[1] || "");
    if (!title || !PROPERTY_WORDS.test(title)) continue;
    const contextStart = before.lastIndexOf("<p", Math.max(0, before.length - 1_500));
    const context = stripTags(before.slice(Math.max(0, contextStart)));
    const documentUrl = new URL(link[1].replace(/%c3/gi, "%C3"), ORIGIN).toString();
    const sourceAuctionId = `SRI-${extractNoticeId(documentUrl).toUpperCase()}`;
    const dateRaw = context.match(/Lugar y fecha de la diligencia:\s*([\s\S]*?)(?=Base para el remate:)/i)?.[1]?.trim() || null;
    const city = dateRaw?.split(",")[0]?.trim() || null;
    const auctionStartAt = ecuadorDate(dateRaw);
    const baseRaw = context.match(/Base para el remate:\s*\$?\s*([\d.,]+)/i)?.[1] || null;
    const appraisalRaw = context.match(/Aval[uú]o del bien:\s*\$?\s*([\d.,]+)/i)?.[1] || null;
    auctions.push({
      source: "SRI",
      sourceAuctionId,
      coactiveProcessNumber: extractNoticeId(documentUrl),
      assetType: normalizeAssetType(title),
      appraisalValue: parseEcuadorMoney(appraisalRaw),
      office: "Servicio de Rentas Internas",
      legalFramework: null,
      publicationStartAt: auctionStartAt,
      publicationEndAt: endOfEcuadorDay(auctionStartAt),
      listingStatus: "Publicado",
      listingSignalingNumber: null,
      imageUrls: [],
      officialListingUrl,
      officialDocumentUrl: documentUrl,
      downloadControl: documentUrl,
      detailControl: null,
      rawListingData: { title, city, dateRaw, baseRaw, appraisalRaw, auctionBaseValue: parseEcuadorMoney(baseRaw) },
    });
  }
  return [...new Map(auctions.map((item) => [item.sourceAuctionId, item])).values()];
};

const fetchPage = async (url: string) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 RematesEcuador/1.0", Accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) throw new Error(`SRI returned HTTP ${response.status}.`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
};

export const scrapeSri = async ({
  shouldDownload = () => false,
  maxDocuments = Number.POSITIVE_INFINITY,
}: {
  shouldDownload?: (auction: DiscoveredAuction) => boolean | Promise<boolean>;
  maxDocuments?: number;
} = {}) => {
  const officialListingUrl = currentPage();
  const html = await (await fetchPage(officialListingUrl)).text();
  const auctions = parseSriAuctions(html, officialListingUrl);
  const documents: AuctionDocument[] = [];
  const metrics: ScrapeMetrics = {
    source: "SRI", pagesVisited: 1, itemsDiscovered: auctions.length, uniqueItems: auctions.length,
    emptyPages: 0, duplicatePages: 0, documentsDownloaded: 0, documentsReused: 0, errors: [],
  };
  for (const auction of auctions) {
    if (documents.length >= maxDocuments || !(await shouldDownload(auction)) || !auction.officialDocumentUrl) continue;
    try {
      const response = await fetchPage(auction.officialDocumentUrl);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.subarray(0, 4).toString() !== "%PDF") throw new Error("SRI document response is not a PDF.");
      documents.push({
        auction, body, contentType: response.headers.get("content-type") || "application/pdf",
        filename: pdfFilename(response.headers.get("content-disposition"), `${auction.sourceAuctionId}.pdf`),
        sha256: createHash("sha256").update(body).digest("hex"),
      });
      metrics.documentsDownloaded += 1;
    } catch (error) {
      metrics.errors.push({ itemId: auction.sourceAuctionId, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return { auctions, documents, metrics };
};

export class SriAdapter implements AuctionSourceAdapter {
  readonly source = "SRI";
  async discoverAuctions() { return (await scrapeSri()).auctions; }
  async fetchAuctionDetail(auction: DiscoveredAuction) { return auction; }
  async downloadDocuments(auction: DiscoveredAuction) {
    return (await scrapeSri({ shouldDownload: (item) => item.sourceAuctionId === auction.sourceAuctionId, maxDocuments: 1 })).documents;
  }
}
