export type AuctionSource =
  | "BIESS"
  | "SRI"
  | "CJ"
  | "CFN"
  | "BANECUADOR"
  | "BANCO_PACIFICO"
  | string;

export type AssetType =
  | "house"
  | "apartment"
  | "land"
  | "commercial"
  | "farm"
  | "warehouse"
  | "building"
  | "other";

export type AuctionStatus =
  | "DISCOVERED"
  | "ACTIVE"
  | "UPCOMING"
  | "AUCTION_TODAY"
  | "EXPIRED"
  | "RESULT_PENDING"
  | "ADJUDICATED"
  | "CANCELLED"
  | "UNKNOWN";

export type Evidence = {
  field: string;
  value: string | number | boolean | null;
  source: "pdf" | "detail" | "listing";
  page: number | null;
  evidence: string;
};

export type Discrepancy = {
  field: string;
  listingValue: unknown;
  documentValue: unknown;
  resolvedUsing: "official_document";
};

export type DiscoveredAuction = {
  source: AuctionSource;
  sourceAuctionId: string;
  coactiveProcessNumber: string | null;
  assetType: AssetType;
  appraisalValue: number | null;
  office: string | null;
  legalFramework: string | null;
  publicationStartAt: string | null;
  publicationEndAt: string | null;
  listingStatus: string | null;
  listingSignalingNumber: 1 | 2 | 3 | null;
  imageUrls: string[];
  officialListingUrl: string;
  officialDocumentUrl: string | null;
  downloadControl: string | null;
  detailControl: string | null;
  rawListingData: Record<string, unknown>;
};

export type AuctionDocument = {
  auction: DiscoveredAuction;
  body: Buffer;
  contentType: string;
  filename: string;
  sha256: string;
};

export type DocumentExtraction = {
  sourceAuctionId: string | null;
  coactiveProcessNumber: string | null;
  assetType: AssetType | null;
  title: string | null;
  description: string | null;
  province: string | null;
  canton: string | null;
  city: string | null;
  parish: string | null;
  neighborhood: string | null;
  address: string | null;
  addressRaw: string | null;
  buildingName: string | null;
  urbanization: string | null;
  latitude: number | null;
  longitude: number | null;
  landAreaM2: number | null;
  constructionAreaM2: number | null;
  apartmentAreaM2: number | null;
  parkingAreaM2: number | null;
  storageAreaM2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  includesParking: boolean | null;
  includesStorage: boolean | null;
  appraisalValue: number | null;
  auctionBaseValue: number | null;
  baseValueDerived: boolean;
  baseValueDerivation: string | null;
  signalingNumber: 1 | 2 | 3 | null;
  signalingRaw: string | null;
  legalFramework: string | null;
  legalArticle: string | null;
  ownershipPercentage: number | null;
  isFullOwnership: boolean | null;
  ownershipDescription: string | null;
  isPropertyHorizontal: boolean | null;
  commonAreaAliquot: number | null;
  qualificationDeadlineAt: string | null;
  documentDeadlineAt: string | null;
  auctionStartAt: string | null;
  auctionEndAt: string | null;
  auctionDate: string | null;
  depositCashPct: number | null;
  depositFinancedPct: number | null;
  allowsFinancing: boolean | null;
  financingTerms: string | null;
  occupancyStatus: string | null;
  liensMentioned: string | null;
  propertyStatus: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  extractionConfidence: number;
  warnings: string[];
  evidence: Evidence[];
};

export type RemateRecord = DiscoveredAuction &
  DocumentExtraction & {
    id: string;
    entity: "AUCTION";
    country: "Ecuador";
    auctionTimezone: "America/Guayaquil";
    listingSignalingNumber: 1 | 2 | 3 | null;
    documentSignalingNumber: 1 | 2 | 3 | null;
    finalSignalingNumber: 1 | 2 | 3 | null;
    baseToAppraisalRatio: number | null;
    discountVsAppraisalPct: number | null;
    dealScore: number;
    verificationScore: number;
    status: AuctionStatus;
    discrepancies: Discrepancy[];
    pdfS3Key: string | null;
    documentHash: string | null;
    documentFilename: string | null;
    documentDownloadedAt: string | null;
    extractionStatus: "PENDING" | "COMPLETE" | "FAILED" | "NOT_AVAILABLE";
    extractionError?: string;
    extractorVersion: string;
    promptVersion: string;
    extractionModel: string | null;
    nativeTextLength: number;
    rawDocumentExtraction: DocumentExtraction;
    firstSeenAt: string;
    lastSeenAt: string;
    extractedAt: string;
    capturedAt: string;
  };

export type ScrapeMetrics = {
  source: AuctionSource;
  pagesVisited: number;
  itemsDiscovered: number;
  uniqueItems: number;
  emptyPages: number;
  duplicatePages: number;
  documentsDownloaded: number;
  documentsReused: number;
  errors: Array<{ itemId?: string; message: string }>;
};

export type SourceScrapeResult = {
  auctions: DiscoveredAuction[];
  documents: AuctionDocument[];
  metrics: ScrapeMetrics;
};

export interface AuctionSourceAdapter {
  source: AuctionSource;
  discoverAuctions(): Promise<DiscoveredAuction[]>;
  fetchAuctionDetail(auction: DiscoveredAuction): Promise<DiscoveredAuction>;
  downloadDocuments(auction: DiscoveredAuction): Promise<AuctionDocument[]>;
}
