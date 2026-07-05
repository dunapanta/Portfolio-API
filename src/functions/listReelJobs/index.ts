import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { createDownloadUrl, getReelJobsTableName } from "@libs/reelJobs";

const defaultTemplateId = "swipe2play-manual-upload-v1";
const maxLimit = 50;

const pickPublishUrl = (result: Record<string, any> | undefined) =>
  result?.shortsUrl || result?.url || result?.permalinkUrl || "";

const publishPriority = (result?: Record<string, any>) => {
  if (!result) return 0;
  if (result.status === "published" || result.publishedAt || result.url || result.id) return 3;
  if (result.status === "processing") return 2;
  return 1;
};

const isNewer = (left?: string, right?: string) => {
  if (!left) return false;
  if (!right) return true;
  return new Date(left).getTime() > new Date(right).getTime();
};

const pickPublishResult = (
  current?: Record<string, any>,
  incoming?: Record<string, any>
) => {
  const currentPriority = publishPriority(current);
  const incomingPriority = publishPriority(incoming);

  if (incomingPriority > currentPriority) return incoming;
  if (incomingPriority < currentPriority) return current;
  return isNewer(incoming?.publishedAt || incoming?.updatedAt, current?.publishedAt || current?.updatedAt)
    ? incoming
    : current;
};

const getReelSignature = (reel: Record<string, any>) => {
  const primaryAsset = reel.primaryAsset ?? {};
  const render = reel.render ?? {};

  return [
    reel.templateId,
    reel.title || "",
    primaryAsset.fileName || render.fileName || "",
    primaryAsset.sizeBytes || render.sizeBytes || "",
    render.durationSeconds || "",
  ].join("|");
};

const summarizeReel = async (reel: Record<string, any>) => {
  const assets = Array.isArray(reel.assets) ? reel.assets : [];
  const publishResults = reel.publishResults ?? {};
  const primaryAsset =
    assets.find((asset: Record<string, any>) => asset.kind === "rendered-reel") ||
    assets.find((asset: Record<string, any>) => asset.kind === "manual-video") ||
    assets.find((asset: Record<string, any>) => asset.key);

  return {
    id: reel.id,
    attemptCount: 1,
    assets: assets.map((asset: Record<string, any>) => ({
      bucket: asset.bucket,
      contentType: asset.contentType,
      fileName: asset.fileName,
      key: asset.key,
      kind: asset.kind,
      sizeBytes: asset.sizeBytes,
      uploadedAt: asset.uploadedAt,
    })),
    createdAt: reel.createdAt,
    expiresAt: reel.expiresAt,
    primaryAsset: primaryAsset
      ? {
          contentType: primaryAsset.contentType,
          bucket: primaryAsset.bucket,
          downloadUrl: primaryAsset.key
            ? await createDownloadUrl(primaryAsset.key, primaryAsset.bucket)
            : undefined,
          fileName: primaryAsset.fileName,
          key: primaryAsset.key,
          kind: primaryAsset.kind,
          sizeBytes: primaryAsset.sizeBytes,
          uploadedAt: primaryAsset.uploadedAt,
        }
      : undefined,
    publishResults: {
      youtube: publishResults.youtube
        ? {
            id: publishResults.youtube.id,
            platform: "youtube",
            publishedAt: publishResults.youtube.publishedAt,
            status: publishResults.youtube.status || "published",
            url: pickPublishUrl(publishResults.youtube),
          }
        : undefined,
      instagram: publishResults.instagram
        ? {
            containerId: publishResults.instagram.containerId,
            id: publishResults.instagram.id,
            platform: "instagram",
            publishedAt: publishResults.instagram.publishedAt,
            status: publishResults.instagram.status || "published",
            statusCode: publishResults.instagram.statusCode,
            updatedAt: publishResults.instagram.updatedAt,
            url: pickPublishUrl(publishResults.instagram),
          }
        : undefined,
      facebook: publishResults.facebook
        ? {
            id: publishResults.facebook.id,
            platform: "facebook",
            publishedAt: publishResults.facebook.publishedAt,
            status: publishResults.facebook.status || "published",
            url: pickPublishUrl(publishResults.facebook),
        }
        : undefined,
    },
    metricsErrors: reel.metricsErrors,
    metricsResults: reel.metricsResults,
    metricsUpdatedAt: reel.metricsUpdatedAt,
    relatedReelIds: [reel.id],
    render: reel.render,
    source: reel.source,
    status: reel.status,
    templateId: reel.templateId,
    title: reel.title,
    updatedAt: reel.updatedAt,
  };
};

const groupReelSummaries = (reels: Array<Record<string, any>>) => {
  const groups = new Map<string, Record<string, any>>();

  reels.forEach((reel) => {
    const signature = getReelSignature(reel);
    const existing = groups.get(signature);

    if (!existing) {
      groups.set(signature, reel);
      return;
    }

    const publishResults = {
      facebook: pickPublishResult(existing.publishResults?.facebook, reel.publishResults?.facebook),
      instagram: pickPublishResult(existing.publishResults?.instagram, reel.publishResults?.instagram),
      youtube: pickPublishResult(existing.publishResults?.youtube, reel.publishResults?.youtube),
    };
    const metricsResults = {
      ...existing.metricsResults,
      ...reel.metricsResults,
    };
    const metricsErrors = {
      ...existing.metricsErrors,
      ...reel.metricsErrors,
    };
    const relatedReelIds = [
      ...(existing.relatedReelIds ?? [existing.id]),
      ...(reel.relatedReelIds ?? [reel.id]),
    ];

    groups.set(signature, {
      ...existing,
      attemptCount: (existing.attemptCount ?? 1) + (reel.attemptCount ?? 1),
      createdAt: isNewer(existing.createdAt, reel.createdAt) ? reel.createdAt : existing.createdAt,
      metricsErrors,
      metricsResults,
      metricsUpdatedAt: isNewer(reel.metricsUpdatedAt, existing.metricsUpdatedAt)
        ? reel.metricsUpdatedAt
        : existing.metricsUpdatedAt,
      publishResults,
      relatedReelIds,
      status: Object.values(publishResults).some(Boolean) ? "published" : existing.status,
      updatedAt: isNewer(reel.updatedAt, existing.updatedAt) ? reel.updatedAt : existing.updatedAt,
    });
  });

  return Array.from(groups.values());
};

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const query = event.queryStringParameters ?? {};
    const templateId = query.templateId || defaultTemplateId;
    const parsedLimit = Number(query.limit ?? 20);
    const limit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(Math.floor(parsedLimit), maxLimit)
        : 20;

    const { items, nextToken } = await dynamo.queryPage({
      tableName: getReelJobsTableName(),
      index: "GSI-reel-jobs-by-template",
      pkKey: "templateId",
      pkValue: templateId,
      limit,
      nextToken: query.nextToken,
      sortAscending: false,
    });

    const reelSummaries = await Promise.all(items.map(summarizeReel));
    const reels = groupReelSummaries(reelSummaries);

    return formatJSONResponse({
      data: {
        message: "Reel jobs retrieved successfully.",
        nextToken,
        reels,
      },
    });
  } catch (err) {
    console.log(err);
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: err.message,
      },
    });
  }
};
