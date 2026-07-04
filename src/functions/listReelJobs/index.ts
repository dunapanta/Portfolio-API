import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { createDownloadUrl, getReelJobsTableName } from "@libs/reelJobs";

const defaultTemplateId = "swipe2play-manual-upload-v1";
const maxLimit = 50;

const pickPublishUrl = (result: Record<string, any> | undefined) =>
  result?.shortsUrl || result?.url || result?.permalinkUrl || "";

const summarizeReel = async (reel: Record<string, any>) => {
  const assets = Array.isArray(reel.assets) ? reel.assets : [];
  const publishResults = reel.publishResults ?? {};
  const primaryAsset =
    assets.find((asset: Record<string, any>) => asset.kind === "rendered-reel") ||
    assets.find((asset: Record<string, any>) => asset.kind === "manual-video") ||
    assets.find((asset: Record<string, any>) => asset.key);

  return {
    id: reel.id,
    assets: assets.map((asset: Record<string, any>) => ({
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
          downloadUrl: primaryAsset.key ? await createDownloadUrl(primaryAsset.key) : undefined,
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
    render: reel.render,
    source: reel.source,
    status: reel.status,
    templateId: reel.templateId,
    title: reel.title,
    updatedAt: reel.updatedAt,
  };
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

    const reels = await Promise.all(items.map(summarizeReel));

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
