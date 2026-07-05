import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { createDownloadUrl, getReelJobsTableName } from "@libs/reelJobs";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const reelId = event.pathParameters?.reelId;

    if (!reelId) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Missing reelId path parameter.",
        },
      });
    }

    const reel = await dynamo.get(reelId, getReelJobsTableName());
    if (!reel) {
      return formatJSONResponse({
        statusCode: 404,
        data: {
          message: "Reel job not found.",
        },
      });
    }

    const assets = Array.isArray(reel.assets) ? reel.assets : [];
    const assetsWithUrls = await Promise.all(
      assets.map(async (asset: Record<string, any>) => ({
        ...asset,
        downloadUrl: asset.key ? await createDownloadUrl(asset.key, asset.bucket) : undefined,
      }))
    );

    return formatJSONResponse({
      data: {
        message: "Reel job retrieved successfully.",
        reel: {
          ...reel,
          assets: assetsWithUrls,
        },
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
