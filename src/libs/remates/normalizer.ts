import {
  AssetType,
  AuctionStatus,
  DiscoveredAuction,
  DocumentExtraction,
  RemateRecord,
} from "./types";

export const EXTRACTOR_VERSION = "1.0.0";
export const PROMPT_VERSION = "remates-ecuador-v1";

export const isReusableDocument = (
  existing: Pick<Partial<RemateRecord>, "documentHash" | "extractionStatus" | "extractorVersion" | "promptVersion"> | undefined,
  documentHash: string
) => Boolean(
  existing?.documentHash === documentHash &&
  existing?.extractionStatus === "COMPLETE" &&
  existing?.extractorVersion === EXTRACTOR_VERSION &&
  existing?.promptVersion === PROMPT_VERSION
);

export const parseEcuadorMoney = (value: string | null | undefined) => {
  if (!value) return null;
  const normalized = value.replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
};

export const normalizeAssetType = (value: string | null | undefined): AssetType => {
  const text = String(value || "").toLocaleLowerCase("es");
  if (text.includes("depart")) return "apartment";
  if (text.includes("casa") || text.includes("vivienda")) return "house";
  if (text.includes("terreno") || text.includes("solar") || text.includes("lote")) return "land";
  if (text.includes("local") || text.includes("comercial")) return "commercial";
  if (text.includes("hacienda") || text.includes("finca")) return "farm";
  if (text.includes("bodega") || text.includes("galp")) return "warehouse";
  if (text.includes("edificio")) return "building";
  return "other";
};

export const signalingFromText = (value: string | null | undefined): 1 | 2 | 3 | null => {
  const text = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (/\bTERCER[OA]?\b|\b3(?:ER|RO|\.?)?\s+SENALAMIENTO/.test(text)) return 3;
  if (/\bSEGUND[OA]?\b|\b2(?:DO|\.?)?\s+SENALAMIENTO/.test(text)) return 2;
  if (/\bPRIMER[OA]?\b|\b1(?:ER|RO|\.?)?\s+SENALAMIENTO/.test(text)) return 1;
  return null;
};

export const ownershipFromText = (value: string) => {
  const text = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  const partial = text.match(/(?:remata|remate|acciones y derechos)[^.%]{0,100}?(\d+(?:[.,]\d+)?)\s*%/) ||
    text.match(/(\d+(?:[.,]\d+)?)\s*%[^.]{0,80}acciones y derechos/);
  if (text.includes("acciones y derechos") && partial) {
    return { ownershipPercentage: Number(partial[1].replace(",", ".")), isFullOwnership: false };
  }
  const horizontal = /propiedad horizontal|alicuota (?:parcial|total|de areas comunes)/.test(text);
  const wholeUnit = /departamento|apartamento|casa|inmueble/.test(text) && !text.includes("acciones y derechos");
  if (horizontal && wholeUnit) return { ownershipPercentage: 100, isFullOwnership: true };
  return { ownershipPercentage: null, isFullOwnership: null };
};

export const explicitHalfBase = (text: string, appraisalValue: number | null) => {
  if (!appraisalValue) return null;
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
  if (!/(base de la mitad|base.*mitad del (?:precio del )?avaluo)/.test(normalized)) return null;
  return Math.round(appraisalValue * 50) / 100;
};

export const shouldStopPagination = ({
  currentIds,
  previousIds,
  seenIds,
}: {
  currentIds: string[];
  previousIds: string[];
  seenIds: Set<string>;
}) => {
  if (!currentIds.length) return { stop: true, reason: "empty" as const };
  const sameAsPrevious = currentIds.length === previousIds.length &&
    currentIds.every((id, index) => id === previousIds[index]);
  if (sameAsPrevious) return { stop: true, reason: "duplicate-page" as const };
  if (currentIds.every((id) => seenIds.has(id))) return { stop: true, reason: "no-new-ids" as const };
  return { stop: false, reason: null };
};

const dayKey = (value: Date) => value.toISOString().slice(0, 10);

export const resolveAuctionStatus = (
  auctionDate: string | null,
  publicationEndAt: string | null,
  listingStatus: string | null,
  now = new Date()
): AuctionStatus => {
  const sourceStatus = String(listingStatus || "").toLocaleLowerCase("es");
  if (sourceStatus.includes("cancel")) return "CANCELLED";
  if (sourceStatus.includes("adjudic")) return "ADJUDICATED";
  if (auctionDate) {
    const date = new Date(`${auctionDate.slice(0, 10)}T00:00:00-05:00`);
    if (!Number.isNaN(date.getTime())) {
      if (dayKey(date) === dayKey(now)) return "AUCTION_TODAY";
      if (date > now) return "UPCOMING";
      return "RESULT_PENDING";
    }
  }
  if (publicationEndAt) {
    const end = new Date(publicationEndAt);
    if (!Number.isNaN(end.getTime())) return end >= now ? "ACTIVE" : "EXPIRED";
  }
  return "UNKNOWN";
};

const round = (value: number) => Math.round(value * 100) / 100;

export const normalizeAuction = ({
  listing,
  extraction,
  documentHash,
  pdfS3Key,
  documentFilename,
  downloadedAt,
  model,
  nativeTextLength,
  existing,
  now = new Date(),
}: {
  listing: DiscoveredAuction;
  extraction: DocumentExtraction;
  documentHash: string;
  pdfS3Key: string;
  documentFilename: string;
  downloadedAt: string;
  model: string;
  nativeTextLength: number;
  existing?: Partial<RemateRecord>;
  now?: Date;
}): RemateRecord => {
  const appraisalValue = extraction.appraisalValue ?? listing.appraisalValue;
  const auctionBaseValue = extraction.auctionBaseValue;
  const baseToAppraisalRatio = appraisalValue && auctionBaseValue !== null
    ? round(auctionBaseValue / appraisalValue)
    : null;
  const discountVsAppraisalPct = baseToAppraisalRatio !== null
    ? round((1 - baseToAppraisalRatio) * 100)
    : null;
  const listingSignalingNumber = listing.listingSignalingNumber;
  const documentSignalingNumber = extraction.signalingNumber;
  const finalSignalingNumber = documentSignalingNumber ?? listingSignalingNumber;
  const discrepancies = listingSignalingNumber && documentSignalingNumber &&
    listingSignalingNumber !== documentSignalingNumber
    ? [{
      field: "signalingNumber",
      listingValue: listingSignalingNumber,
      documentValue: documentSignalingNumber,
      resolvedUsing: "official_document" as const,
    }]
    : [];
  const hasCriticalEvidence = (field: string) => extraction.evidence.some((item) => item.field === field);
  const verificationParts = [
    20,
    extraction.address ? 15 : 0,
    extraction.isFullOwnership !== null ? 15 : 0,
    auctionBaseValue !== null && hasCriticalEvidence("auctionBaseValue") ? 20 : 0,
    extraction.auctionDate ? 15 : 0,
    documentSignalingNumber ? 15 : 0,
  ];
  const verificationScore = Math.max(0, verificationParts.reduce((sum, item) => sum + item, 0) - discrepancies.length * 5);
  const dealScore = Math.max(0, Math.min(100, round(
    (discountVsAppraisalPct ?? 0) * 0.9 +
    (extraction.isFullOwnership === true ? 18 : extraction.isFullOwnership === false ? -35 : 0) +
    (finalSignalingNumber === 3 ? 12 : finalSignalingNumber === 2 ? 7 : 2) +
    verificationScore * 0.2
  )));
  const timestamp = now.toISOString();

  return {
    ...listing,
    ...extraction,
    id: listing.sourceAuctionId,
    entity: "AUCTION",
    source: listing.source,
    sourceAuctionId: listing.sourceAuctionId,
    coactiveProcessNumber: extraction.coactiveProcessNumber ?? listing.coactiveProcessNumber,
    assetType: extraction.assetType ?? listing.assetType,
    appraisalValue,
    legalFramework: extraction.legalFramework ?? listing.legalFramework,
    country: "Ecuador",
    auctionTimezone: "America/Guayaquil",
    listingSignalingNumber,
    documentSignalingNumber,
    finalSignalingNumber,
    baseToAppraisalRatio,
    discountVsAppraisalPct,
    dealScore,
    verificationScore,
    status: resolveAuctionStatus(extraction.auctionDate, listing.publicationEndAt, listing.listingStatus, now),
    discrepancies,
    pdfS3Key,
    documentHash,
    documentFilename,
    documentDownloadedAt: downloadedAt,
    extractionStatus: "COMPLETE",
    extractorVersion: EXTRACTOR_VERSION,
    promptVersion: PROMPT_VERSION,
    extractionModel: model,
    nativeTextLength,
    rawDocumentExtraction: extraction,
    firstSeenAt: existing?.firstSeenAt || timestamp,
    lastSeenAt: timestamp,
    extractedAt: timestamp,
    capturedAt: timestamp,
  };
};
