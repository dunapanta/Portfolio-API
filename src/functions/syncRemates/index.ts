import { randomUUID } from "node:crypto";

import { dynamo } from "@libs/dynamo";
import { BiessHttpAdapter, scrapeBiess } from "@libs/remates/biessHttpAdapter";
import { EXTRACTOR_VERSION, PROMPT_VERSION, isReusableDocument, resolveAuctionStatus } from "@libs/remates/normalizer";
import {
  putRemateObject,
  queueRemateExtraction,
  rematesTableName,
} from "@libs/remates/store";
import { DiscoveredAuction, RemateRecord } from "@libs/remates/types";

const validationDetailIds = new Set(
  String(process.env.REMATES_DETAIL_VALIDATION_IDS || "BIESS-UIO-2026-0110")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
);

const pendingRecord = ({
  listing,
  existing,
  pdfS3Key,
  documentHash,
  documentFilename,
  downloadedAt,
  now,
}: {
  listing: DiscoveredAuction;
  existing?: Partial<RemateRecord>;
  pdfS3Key: string | null;
  documentHash: string | null;
  documentFilename: string | null;
  downloadedAt: string | null;
  now: string;
}) => ({
  ...(existing || {}),
  ...listing,
  id: listing.sourceAuctionId,
  entity: "AUCTION",
  country: "Ecuador",
  auctionTimezone: "America/Guayaquil",
  documentSignalingNumber: existing?.documentSignalingNumber ?? null,
  finalSignalingNumber: existing?.documentSignalingNumber ?? listing.listingSignalingNumber,
  status: resolveAuctionStatus(existing?.auctionDate || null, listing.publicationEndAt, listing.listingStatus),
  pdfS3Key,
  documentHash,
  documentFilename,
  documentDownloadedAt: downloadedAt,
  extractionStatus: pdfS3Key ? "PENDING" : "NOT_AVAILABLE",
  extractorVersion: EXTRACTOR_VERSION,
  promptVersion: PROMPT_VERSION,
  extractionModel: existing?.extractionModel || null,
  nativeTextLength: existing?.nativeTextLength || 0,
  dealScore: existing?.dealScore || 0,
  verificationScore: existing?.verificationScore || 0,
  discrepancies: existing?.discrepancies || [],
  firstSeenAt: existing?.firstSeenAt || now,
  lastSeenAt: now,
  capturedAt: now,
});

export const handler = async () => {
  const tableName = rematesTableName();
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const runRecord = {
    id: `run#${runId}`,
    entity: "SCRAPE_RUN",
    runId,
    source: "BIESS",
    status: "RUNNING",
    startedAt,
    capturedAt: startedAt,
    pagesVisited: 0,
    auctionsDiscovered: 0,
    newAuctions: 0,
    updatedAuctions: 0,
    pdfsDownloaded: 0,
    pdfsReused: 0,
    successfulExtractions: 0,
    failedExtractions: 0,
    errors: [],
  };
  await dynamo.write(runRecord, tableName);

  try {
    const existingItems = ((await dynamo.getAll(tableName)) || []) as Array<Partial<RemateRecord> & { id: string; entity?: string }>;
    const existingById = new Map(existingItems.filter((item) => item.entity === "AUCTION").map((item) => [item.id, item]));
    const { auctions, documents, metrics } = await scrapeBiess({ shouldDownload: () => true });
    const detailAdapter = new BiessHttpAdapter();
    const auctionsWithDetails = await Promise.all(auctions.map(async (auction) => {
      if (!validationDetailIds.has(auction.sourceAuctionId)) return auction;
      try {
        return await detailAdapter.fetchAuctionDetail(auction);
      } catch (error) {
        metrics.errors.push({
          itemId: auction.sourceAuctionId,
          message: `Detail validation failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        return auction;
      }
    }));
    const documentsById = new Map(documents.map((item) => [item.auction.sourceAuctionId, item]));
    const now = new Date().toISOString();
    const maxExtractions = Math.max(1, Number(process.env.REMATES_MAX_EXTRACTIONS_PER_RUN || 20));
    let queued = 0;
    let newAuctions = 0;
    let updatedAuctions = 0;

    for (const listing of auctionsWithDetails) {
      const existing = existingById.get(listing.sourceAuctionId);
      const document = documentsById.get(listing.sourceAuctionId);
      if (existing) updatedAuctions += 1;
      else newAuctions += 1;

      if (!document) {
        await dynamo.write(pendingRecord({
          listing,
          existing,
          pdfS3Key: existing?.pdfS3Key || null,
          documentHash: existing?.documentHash || null,
          documentFilename: existing?.documentFilename || null,
          downloadedAt: existing?.documentDownloadedAt || null,
          now,
        }), tableName);
        continue;
      }

      const year = listing.sourceAuctionId.match(/-(\d{4})-/)?.[1] || new Date().getFullYear();
      const pdfS3Key = `remates/raw/biess/${year}/${listing.sourceAuctionId}/extract-${document.sha256}.pdf`;
      const metadataS3Key = `remates/raw/biess/${year}/${listing.sourceAuctionId}/metadata-${document.sha256}.json`;
      const reusable = isReusableDocument(existing, document.sha256);

      if (reusable) {
        metrics.documentsReused += 1;
        await dynamo.write({ ...existing, ...listing, lastSeenAt: now, capturedAt: now }, tableName);
        continue;
      }

      await Promise.all([
        putRemateObject({ key: pdfS3Key, body: document.body, contentType: "application/pdf" }),
        putRemateObject({
          key: metadataS3Key,
          body: JSON.stringify({
            source: "BIESS",
            sourceAuctionId: listing.sourceAuctionId,
            originalSourceUrl: listing.officialListingUrl,
            originalDocumentUrl: null,
            sha256: document.sha256,
            downloadedAt: now,
            filename: document.filename,
            rawListingData: listing.rawListingData,
          }, null, 2),
          contentType: "application/json",
        }),
      ]);

      await dynamo.write(pendingRecord({
        listing,
        existing,
        pdfS3Key,
        documentHash: document.sha256,
        documentFilename: document.filename,
        downloadedAt: now,
        now,
      }), tableName);

      if (queued < maxExtractions) {
        await queueRemateExtraction({
          runId,
          listing,
          pdfS3Key,
          documentHash: document.sha256,
          documentFilename: document.filename,
          downloadedAt: now,
        });
        queued += 1;
      }
    }

    const completedAt = new Date().toISOString();
    const status = metrics.errors.length ? "PARTIAL_SUCCESS" : "SUCCESS";
    await dynamo.write({
      ...runRecord,
      status,
      completedAt,
      capturedAt: completedAt,
      pagesVisited: metrics.pagesVisited,
      auctionsDiscovered: metrics.uniqueItems,
      newAuctions,
      updatedAuctions,
      pdfsDownloaded: metrics.documentsDownloaded,
      pdfsReused: metrics.documentsReused,
      extractionJobsQueued: queued,
      emptyPages: metrics.emptyPages,
      duplicatePages: metrics.duplicatePages,
      errors: metrics.errors,
    }, tableName);
    console.log(JSON.stringify({ action: "remates_scrape", runId, status, metrics, queued }));
    return { runId, status, metrics, queued };
  } catch (error) {
    const completedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : String(error);
    await dynamo.write({ ...runRecord, status: "FAILED", completedAt, capturedAt: completedAt, errors: [{ message }] }, tableName);
    console.error(JSON.stringify({ action: "remates_scrape", runId, status: "failed", error: message }));
    throw error;
  }
};
