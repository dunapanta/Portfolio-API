import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  EXTRACTOR_VERSION,
  explicitHalfBase,
  isReusableDocument,
  normalizeAuction,
  ownershipFromText,
  resolveAuctionStatus,
  shouldStopPagination,
} from "../normalizer";
import { DiscoveredAuction, DocumentExtraction } from "../types";

const listing: DiscoveredAuction = {
  source: "BIESS",
  sourceAuctionId: "BIESS-UIO-2026-0110",
  coactiveProcessNumber: "0311-2020",
  assetType: "apartment",
  appraisalValue: 251967.44,
  office: "DIRECCIÓN DE COACTIVAS QUITO",
  legalFramework: "CÓDIGO ORGÁNICO ADMINISTRATIVO",
  publicationStartAt: "2026-07-10T09:18:00-05:00",
  publicationEndAt: "2026-08-17T23:59:00-05:00",
  listingStatus: "Bien Publicado",
  listingSignalingNumber: 1,
  imageUrls: [],
  officialListingUrl: "https://rematevirtual.biess.fin.ec/",
  downloadControl: null,
  detailControl: null,
  rawListingData: { signaling: "PRIMERO" },
};

const extraction = {
  sourceAuctionId: listing.sourceAuctionId,
  coactiveProcessNumber: listing.coactiveProcessNumber,
  assetType: "apartment",
  appraisalValue: 251967.44,
  auctionBaseValue: 125983.72,
  baseValueDerived: false,
  baseValueDerivation: null,
  signalingNumber: 3,
  signalingRaw: "TERCER SEÑALAMIENTO",
  ownershipPercentage: 100,
  isFullOwnership: true,
  auctionDate: "2026-08-17",
  extractionConfidence: 0.98,
  warnings: [],
  evidence: [
    { field: "auctionBaseValue", value: 125983.72, source: "pdf", page: 2, evidence: "USD 125.983,72" },
  ],
} as DocumentExtraction;

test("the official document wins when BIESS listing says first and PDF says third", () => {
  const result = normalizeAuction({
    listing,
    extraction,
    documentHash: "hash",
    pdfS3Key: "doc.pdf",
    documentFilename: "doc.pdf",
    downloadedAt: "2026-08-07T12:00:00.000Z",
    model: "test-model",
    nativeTextLength: 0,
    now: new Date("2026-08-07T12:00:00.000Z"),
  });
  assert.equal(result.finalSignalingNumber, 3);
  assert.deepEqual(result.discrepancies[0], {
    field: "signalingNumber",
    listingValue: 1,
    documentValue: 3,
    resolvedUsing: "official_document",
  });
});

test("actions and rights are partial ownership", () => {
  assert.deepEqual(ownershipFromText("Se remata el 50% de acciones y derechos del inmueble"), {
    ownershipPercentage: 50,
    isFullOwnership: false,
  });
});

test("horizontal-property aliquots are not mistaken for partial ownership", () => {
  assert.deepEqual(ownershipFromText("Departamento completo bajo propiedad horizontal, alícuota parcial de áreas comunes"), {
    ownershipPercentage: 100,
    isFullOwnership: true,
  });
});

test("resolved horizontal ownership does not keep a contradictory review warning", () => {
  const result = normalizeAuction({
    listing,
    extraction: {
      ...extraction,
      ownershipPercentage: 100,
      isFullOwnership: true,
      isPropertyHorizontal: true,
      warnings: ["OWNERSHIP_REQUIRES_REVIEW"],
    },
    documentHash: "hash",
    pdfS3Key: "document.pdf",
    documentFilename: "document.pdf",
    downloadedAt: "2026-08-08T00:00:00.000Z",
    model: "gpt-5.4-mini",
    nativeTextLength: 0,
  });

  assert.deepEqual(result.warnings, []);
});

test("half of appraisal is derived only from explicit document language", () => {
  assert.equal(explicitHalfBase("El remate se realizará sobre la base de la mitad del precio del avalúo", 251967.44), 125983.72);
  assert.equal(explicitHalfBase("TERCER SEÑALAMIENTO", 251967.44), null);
});

test("publication end is not copied into auction date", () => {
  assert.equal(resolveAuctionStatus(null, "2026-08-17T23:59:00-05:00", "Bien Publicado", new Date("2026-08-07T12:00:00Z")), "ACTIVE");
});

test("same successful hash and extractor version is reusable", () => {
  assert.equal(isReusableDocument({ documentHash: "abc", extractionStatus: "COMPLETE", extractorVersion: EXTRACTOR_VERSION, promptVersion: "remates-ecuador-v1" }, "abc"), true);
  assert.equal(isReusableDocument({ documentHash: "abc", extractionStatus: "FAILED", extractorVersion: EXTRACTOR_VERSION, promptVersion: "remates-ecuador-v1" }, "abc"), false);
});

test("pagination stops on an empty page", () => {
  assert.deepEqual(shouldStopPagination({ currentIds: [], previousIds: ["a"], seenIds: new Set(["a"]) }), { stop: true, reason: "empty" });
});

test("pagination stops on a repeated page", () => {
  assert.deepEqual(shouldStopPagination({ currentIds: ["a"], previousIds: ["a"], seenIds: new Set(["a"]) }), { stop: true, reason: "duplicate-page" });
});
