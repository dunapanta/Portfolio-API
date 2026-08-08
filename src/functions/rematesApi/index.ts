import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { APIGatewayProxyEventV2 } from "aws-lambda";

import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { rematesBucketName, rematesTableName } from "@libs/remates/store";
import { RemateRecord } from "@libs/remates/types";

const lambda = new LambdaClient({});
const s3 = new S3Client({});

const numberParam = (value: string | undefined) => {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const booleanParam = (value: string | undefined) => value === "true" ? true : value === "false" ? false : null;

const publicSummary = (record: RemateRecord) => {
  const { rawDocumentExtraction: _rawDocumentExtraction, rawListingData: _rawListingData, ...summary } = record;
  return summary;
};

const encodeOffset = (value: number) => Buffer.from(String(value)).toString("base64url");
const decodeOffset = (value?: string) => {
  if (!value) return 0;
  const parsed = Number(Buffer.from(value, "base64url").toString("utf8"));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const sortAuctions = (items: RemateRecord[], sort: string) => [...items].sort((a, b) => {
  if (sort === "auctionDate") return String(a.auctionDate || "9999").localeCompare(String(b.auctionDate || "9999"));
  if (sort === "newest") return String(b.firstSeenAt).localeCompare(String(a.firstSeenAt));
  if (sort === "baseAsc") return (a.auctionBaseValue ?? Number.POSITIVE_INFINITY) - (b.auctionBaseValue ?? Number.POSITIVE_INFINITY);
  if (sort === "baseDesc") return (b.auctionBaseValue ?? -1) - (a.auctionBaseValue ?? -1);
  if (sort === "appraisalAsc") return (a.appraisalValue ?? Number.POSITIVE_INFINITY) - (b.appraisalValue ?? Number.POSITIVE_INFINITY);
  if (sort === "discountDesc") return (b.discountVsAppraisalPct ?? -1) - (a.discountVsAppraisalPct ?? -1);
  return (b.dealScore || 0) - (a.dealScore || 0) || (b.verificationScore || 0) - (a.verificationScore || 0);
});

const listAuctions = async (event: APIGatewayProxyEventV2) => {
  const query = event.queryStringParameters || {};
  const all = ((await dynamo.getAll(rematesTableName())) || []).filter((item) => item.entity === "AUCTION") as RemateRecord[];
  const minAppraisal = numberParam(query.minAppraisal);
  const maxAppraisal = numberParam(query.maxAppraisal);
  const minBase = numberParam(query.minBase);
  const maxBase = numberParam(query.maxBase);
  const minDiscountPct = numberParam(query.minDiscountPct);
  const fullOwnershipOnly = booleanParam(query.fullOwnershipOnly);
  const upcomingOnly = booleanParam(query.upcomingOnly);
  const hasDocument = booleanParam(query.hasDocument);
  const hasWarnings = booleanParam(query.hasWarnings);
  const hasExactAddress = booleanParam(query.hasExactAddress);

  const filtered = all.filter((item) =>
    (!query.source || item.source === query.source.toUpperCase()) &&
    (!query.assetType || item.assetType === query.assetType) &&
    (!query.province || item.province === query.province) &&
    (!query.canton || item.canton === query.canton) &&
    (!query.city || item.city === query.city) &&
    (!query.parish || item.parish === query.parish) &&
    (!query.signalingNumber || item.finalSignalingNumber === Number(query.signalingNumber)) &&
    (fullOwnershipOnly !== true || item.isFullOwnership === true) &&
    (minAppraisal === null || (item.appraisalValue !== null && item.appraisalValue >= minAppraisal)) &&
    (maxAppraisal === null || (item.appraisalValue !== null && item.appraisalValue <= maxAppraisal)) &&
    (minBase === null || (item.auctionBaseValue !== null && item.auctionBaseValue >= minBase)) &&
    (maxBase === null || (item.auctionBaseValue !== null && item.auctionBaseValue <= maxBase)) &&
    (minDiscountPct === null || (item.discountVsAppraisalPct !== null && item.discountVsAppraisalPct >= minDiscountPct)) &&
    (!query.auctionFrom || (item.auctionDate !== null && item.auctionDate >= query.auctionFrom)) &&
    (!query.auctionTo || (item.auctionDate !== null && item.auctionDate <= query.auctionTo)) &&
    (upcomingOnly !== true || ["ACTIVE", "UPCOMING", "AUCTION_TODAY"].includes(item.status)) &&
    (!query.legalFramework || item.legalFramework === query.legalFramework) &&
    (!query.status || item.status === query.status) &&
    (hasDocument === null || Boolean(item.pdfS3Key) === hasDocument) &&
    (hasWarnings === null || Boolean(item.warnings?.length) === hasWarnings) &&
    (hasExactAddress === null || Boolean(item.address) === hasExactAddress)
  );
  const sorted = sortAuctions(filtered, query.sort || "best");
  const limit = Math.max(1, Math.min(100, Number(query.limit || 30)));
  const offset = decodeOffset(query.nextToken);
  const page = sorted.slice(offset, offset + limit);
  return formatJSONResponse({
    data: {
      items: page.map(publicSummary),
      total: sorted.length,
      nextToken: offset + limit < sorted.length ? encodeOffset(offset + limit) : undefined,
    },
  });
};

const detail = async (id: string) => {
  if (!/^[A-Z0-9#_-]{3,100}$/i.test(id)) return formatJSONResponse({ statusCode: 400, data: { message: "Invalid auction id." } });
  const item = await dynamo.get(id, rematesTableName()) as RemateRecord | undefined;
  if (!item || item.entity !== "AUCTION") return formatJSONResponse({ statusCode: 404, data: { message: "Auction not found." } });
  const documentUrl = item.pdfS3Key
    ? await getSignedUrl(s3, new GetObjectCommand({ Bucket: rematesBucketName(), Key: item.pdfS3Key }), { expiresIn: 900 })
    : null;
  return formatJSONResponse({ data: { item, documentUrl, documentUrlExpiresIn: documentUrl ? 900 : null } });
};

const filters = async () => {
  const items = ((await dynamo.getAll(rematesTableName())) || []).filter((item) => item.entity === "AUCTION") as RemateRecord[];
  const values = (key: keyof RemateRecord) => [...new Set(items.map((item) => item[key]).filter(Boolean))].sort();
  return formatJSONResponse({ data: {
    sources: values("source"),
    assetTypes: values("assetType"),
    provinces: values("province"),
    cantons: values("canton"),
    cities: values("city"),
    parishes: values("parish"),
    legalFrameworks: values("legalFramework"),
  } });
};

const stats = async () => {
  const items = ((await dynamo.getAll(rematesTableName())) || []).filter((item) => item.entity === "AUCTION") as RemateRecord[];
  const now = new Date();
  const sevenDays = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const active = items.filter((item) => ["ACTIVE", "UPCOMING", "AUCTION_TODAY"].includes(item.status));
  const bySource = Object.fromEntries([...new Set(items.map((item) => item.source))].sort().map((source) => [source, items.filter((item) => item.source === source).length]));
  return formatJSONResponse({ data: {
    total: items.length,
    active: active.length,
    fullOwnership: active.filter((item) => item.isFullOwnership === true).length,
    secondSignaling: active.filter((item) => item.finalSignalingNumber === 2).length,
    thirdSignaling: active.filter((item) => item.finalSignalingNumber === 3).length,
    nextSevenDays: active.filter((item) => item.auctionDate && item.auctionDate <= sevenDays).length,
    verifiedDocuments: items.filter((item) => item.extractionStatus === "COMPLETE").length,
    bySource,
    lastUpdatedAt: items.map((item) => item.lastSeenAt).sort().at(-1) || null,
  } });
};

const scrapeRuns = async () => {
  const items = ((await dynamo.getAll(rematesTableName())) || [])
    .filter((item) => item.entity === "SCRAPE_RUN")
    .sort((a, b) => String(b.capturedAt).localeCompare(String(a.capturedAt)))
    .slice(0, 30);
  return formatJSONResponse({ data: { items } });
};

const triggerScrape = async (event: APIGatewayProxyEventV2) => {
  const supplied = event.headers?.["x-remates-admin-key"] || event.headers?.["X-Remates-Admin-Key"];
  const expected = process.env.REMATES_ADMIN_KEY || process.env.MAGIC_LAYERS_ACCESS_KEY;
  if (!expected || supplied !== expected) return formatJSONResponse({ statusCode: 401, data: { message: "Unauthorized." } });
  if (!process.env.REMATES_SYNC_FUNCTION_NAME) throw new Error("Remates sync function is not configured.");
  const body = event.body ? JSON.parse(event.body) as { source?: string } : {};
  const source = String(body.source || "ALL").toUpperCase();
  if (!["ALL", "BIESS", "SRI", "CJ", "CFN"].includes(source)) return formatJSONResponse({ statusCode: 400, data: { message: "Unsupported source." } });
  await lambda.send(new InvokeCommand({
    FunctionName: process.env.REMATES_SYNC_FUNCTION_NAME,
    InvocationType: "Event",
    Payload: Buffer.from(JSON.stringify({ source, triggeredBy: "admin" })),
  }));
  return formatJSONResponse({ statusCode: 202, data: { message: `${source} scrape queued.` } });
};

export const handler = async (event: APIGatewayProxyEventV2) => {
  try {
    const path = event.rawPath || "";
    if (event.requestContext.http.method === "POST" && path.endsWith("/admin/scrape")) return triggerScrape(event);
    if (path.endsWith("/filters")) return filters();
    if (path.endsWith("/stats")) return stats();
    if (path.endsWith("/scrape-runs")) return scrapeRuns();
    if (event.pathParameters?.id) return detail(decodeURIComponent(event.pathParameters.id));
    return listAuctions(event);
  } catch (error) {
    console.error(JSON.stringify({ action: "remates_api", status: "failed", error: error instanceof Error ? error.message : String(error) }));
    return formatJSONResponse({ statusCode: 500, data: { message: "No se pudo consultar Remates Ecuador." } });
  }
};
