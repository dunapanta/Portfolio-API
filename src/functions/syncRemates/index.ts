import { randomUUID } from "node:crypto";

import { dynamo } from "@libs/dynamo";
import { BiessHttpAdapter, scrapeBiess } from "@libs/remates/biessHttpAdapter";
import { scrapeCfn } from "@libs/remates/cfnAdapter";
import { scrapeCj } from "@libs/remates/cjAdapter";
import { EXTRACTOR_VERSION, PROMPT_VERSION, isReusableDocument, resolveAuctionStatus } from "@libs/remates/normalizer";
import { scrapeSri } from "@libs/remates/sriAdapter";
import { putRemateObject, queueRemateExtraction, rematesTableName } from "@libs/remates/store";
import { AuctionSource, DiscoveredAuction, RemateRecord, SourceScrapeResult } from "@libs/remates/types";

type SyncSource = "BIESS" | "SRI" | "CJ" | "CFN";
type SyncEvent = { source?: SyncSource | "ALL" | string; triggeredBy?: string };

const validationDetailIds = new Set(
  String(process.env.REMATES_DETAIL_VALIDATION_IDS || "BIESS-UIO-2026-0110").split(",").map((item) => item.trim()).filter(Boolean)
);

const pendingRecord = ({ listing, existing, pdfS3Key, documentHash, documentFilename, downloadedAt, now }: {
  listing: DiscoveredAuction; existing?: Partial<RemateRecord>; pdfS3Key: string | null; documentHash: string | null;
  documentFilename: string | null; downloadedAt: string | null; now: string;
}) => {
  const preservesExistingDocument = Boolean(
    pdfS3Key && documentHash && existing?.pdfS3Key === pdfS3Key && existing?.documentHash === documentHash
  );
  return ({
    ...(existing || {}), ...listing, id: listing.sourceAuctionId, entity: "AUCTION", country: "Ecuador", auctionTimezone: "America/Guayaquil",
    documentSignalingNumber: existing?.documentSignalingNumber ?? null,
    finalSignalingNumber: existing?.documentSignalingNumber ?? listing.listingSignalingNumber,
    status: resolveAuctionStatus(existing?.auctionDate || null, listing.publicationEndAt, listing.listingStatus),
    pdfS3Key, documentHash, documentFilename, documentDownloadedAt: downloadedAt,
    extractionStatus: pdfS3Key
      ? (preservesExistingDocument ? (existing?.extractionStatus || "PENDING") : "PENDING")
      : (existing?.extractionStatus || "NOT_AVAILABLE"),
    extractorVersion: EXTRACTOR_VERSION, promptVersion: PROMPT_VERSION, extractionModel: existing?.extractionModel || null,
    nativeTextLength: existing?.nativeTextLength || 0, dealScore: existing?.dealScore || 0, verificationScore: existing?.verificationScore || 0,
    discrepancies: existing?.discrepancies || [], warnings: existing?.warnings || [], evidence: existing?.evidence || [],
    firstSeenAt: existing?.firstSeenAt || now, lastSeenAt: now, capturedAt: now,
  });
};

const needsDocumentRefresh = (existing: Partial<RemateRecord> | undefined, now = Date.now()) => {
  if (!existing?.documentHash || existing.extractionStatus !== "COMPLETE") return true;
  const refreshDays = Math.max(1, Number(process.env.REMATES_DOCUMENT_REFRESH_DAYS || 28));
  const downloaded = existing.documentDownloadedAt ? new Date(existing.documentDownloadedAt).getTime() : 0;
  return !downloaded || now - downloaded >= refreshDays * 86_400_000;
};

const scrapeSource = async (
  source: SyncSource,
  existingById: Map<string, Partial<RemateRecord>>,
  maxDocuments: number
): Promise<SourceScrapeResult> => {
  const shouldDownload = (auction: DiscoveredAuction) => needsDocumentRefresh(existingById.get(auction.sourceAuctionId));
  if (source === "BIESS") return scrapeBiess({ shouldDownload, maxDocuments });
  if (source === "SRI") return scrapeSri({ shouldDownload, maxDocuments });
  if (source === "CJ") return scrapeCj({ shouldDownload, maxDocuments });
  return scrapeCfn({ shouldDownload, maxDocuments });
};

const sourceFolder = (source: AuctionSource) => source.toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "-");

const runSource = async (source: SyncSource) => {
  const tableName = rematesTableName();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const runRecord = {
    id: `run#${runId}`, entity: "SCRAPE_RUN", runId, source, status: "RUNNING", startedAt, capturedAt: startedAt,
    pagesVisited: 0, auctionsDiscovered: 0, newAuctions: 0, updatedAuctions: 0, pdfsDownloaded: 0, pdfsReused: 0,
    successfulExtractions: 0, failedExtractions: 0, errors: [],
  };
  await dynamo.write(runRecord, tableName);

  try {
    const existingItems = ((await dynamo.getAll(tableName)) || []) as Array<Partial<RemateRecord> & { id: string; entity?: string }>;
    const existingById = new Map(existingItems.filter((item) => item.entity === "AUCTION").map((item) => [item.id, item]));
    const maxDocuments = Math.max(1, Number(process.env.REMATES_MAX_DOCUMENTS_PER_SOURCE_PER_RUN || 25));
    const result = await scrapeSource(source, existingById, maxDocuments);
    const { auctions, documents, metrics } = result;

    if (source === "BIESS") {
      const detailAdapter = new BiessHttpAdapter();
      for (let index = 0; index < auctions.length; index += 1) {
        if (!validationDetailIds.has(auctions[index].sourceAuctionId)) continue;
        try { auctions[index] = await detailAdapter.fetchAuctionDetail(auctions[index]); }
        catch (error) { metrics.errors.push({ itemId: auctions[index].sourceAuctionId, message: `Detail validation failed: ${error instanceof Error ? error.message : String(error)}` }); }
      }
    }

    const documentsById = new Map(documents.map((item) => [item.auction.sourceAuctionId, item]));
    const now = new Date().toISOString();
    const maxExtractions = Math.max(1, Number(process.env.REMATES_MAX_EXTRACTIONS_PER_RUN || 20));
    let queued = 0;
    let newAuctions = 0;
    let updatedAuctions = 0;

    for (const discovered of auctions) {
      const document = documentsById.get(discovered.sourceAuctionId);
      const listing = document?.auction || discovered;
      const existing = existingById.get(listing.sourceAuctionId);
      if (existing) updatedAuctions += 1; else newAuctions += 1;

      if (!document) {
        await dynamo.write(pendingRecord({
          listing, existing, pdfS3Key: existing?.pdfS3Key || null, documentHash: existing?.documentHash || null,
          documentFilename: existing?.documentFilename || null, downloadedAt: existing?.documentDownloadedAt || null, now,
        }), tableName);
        continue;
      }

      const year = listing.publicationStartAt?.slice(0, 4) || listing.sourceAuctionId.match(/-(\d{4})-/)?.[1] || String(new Date().getFullYear());
      const folder = sourceFolder(listing.source);
      const pdfS3Key = `remates/raw/${folder}/${year}/${listing.sourceAuctionId}/extract-${document.sha256}.pdf`;
      const metadataS3Key = `remates/raw/${folder}/${year}/${listing.sourceAuctionId}/metadata-${document.sha256}.json`;
      const reusable = isReusableDocument(existing, document.sha256);
      if (reusable) {
        metrics.documentsReused += 1;
        await dynamo.write({ ...existing, ...listing, lastSeenAt: now, capturedAt: now, documentDownloadedAt: now }, tableName);
        continue;
      }

      await Promise.all([
        putRemateObject({ key: pdfS3Key, body: document.body, contentType: "application/pdf" }),
        putRemateObject({
          key: metadataS3Key,
          body: JSON.stringify({
            source: listing.source, sourceAuctionId: listing.sourceAuctionId, originalSourceUrl: listing.officialListingUrl,
            originalDocumentUrl: listing.officialDocumentUrl, sha256: document.sha256, downloadedAt: now,
            filename: document.filename, rawListingData: listing.rawListingData,
          }, null, 2),
          contentType: "application/json",
        }),
      ]);

      await dynamo.write(pendingRecord({ listing, existing, pdfS3Key, documentHash: document.sha256, documentFilename: document.filename, downloadedAt: now, now }), tableName);
      if (queued < maxExtractions) {
        await queueRemateExtraction({ runId, listing, pdfS3Key, documentHash: document.sha256, documentFilename: document.filename, downloadedAt: now });
        queued += 1;
      }
    }

    const completedAt = new Date().toISOString();
    const status = metrics.errors.length ? "PARTIAL_SUCCESS" : "SUCCESS";
    await dynamo.write({
      ...runRecord, status, completedAt, capturedAt: completedAt, pagesVisited: metrics.pagesVisited,
      auctionsDiscovered: metrics.uniqueItems, newAuctions, updatedAuctions, pdfsDownloaded: metrics.documentsDownloaded,
      pdfsReused: metrics.documentsReused, extractionJobsQueued: queued, emptyPages: metrics.emptyPages,
      duplicatePages: metrics.duplicatePages, errors: metrics.errors,
    }, tableName);
    console.log(JSON.stringify({ action: "remates_scrape", source, runId, status, metrics, queued }));
    return { source, runId, status, metrics, queued };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    await dynamo.write({ ...runRecord, status: "FAILED", completedAt, capturedAt: completedAt, errors: [{ message }] }, tableName);
    console.error(JSON.stringify({ action: "remates_scrape", source, runId, status: "failed", error: message }));
    throw error;
  }
};

export const handler = async (event: SyncEvent = {}) => {
  const requested = String(event.source || "ALL").toUpperCase();
  const sources: SyncSource[] = requested === "ALL" ? ["BIESS", "SRI", "CJ", "CFN"] : [requested as SyncSource];
  if (sources.some((source) => !["BIESS", "SRI", "CJ", "CFN"].includes(source))) throw new Error(`Unsupported remates source: ${requested}`);
  const results = [];
  for (const source of sources) results.push(await runSource(source));
  return requested === "ALL" ? { results } : results[0];
};
