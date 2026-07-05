import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { createDownloadUrl, getReelJobsTableName } from "@libs/reelJobs";
import { getSwipe2PlayRenderProgress } from "@libs/remotionLambda";

const withAssetDownloadUrls = async (reel: Record<string, any>) => {
  const assets = Array.isArray(reel.assets) ? reel.assets : [];
  const assetsWithUrls = await Promise.all(
    assets.map(async (asset: Record<string, any>) => ({
      ...asset,
      downloadUrl: asset.key ? await createDownloadUrl(asset.key, asset.bucket) : undefined,
    }))
  );

  return {
    ...reel,
    assets: assetsWithUrls,
  };
};

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const reelId = event.pathParameters?.reelId;

    if (!reelId) {
      return formatJSONResponse({
        statusCode: 400,
        data: { message: "Missing reelId path parameter." },
      });
    }

    const reel = await dynamo.get(reelId, getReelJobsTableName());
    if (!reel) {
      return formatJSONResponse({
        statusCode: 404,
        data: { message: "Reel job not found." },
      });
    }

    const lambda = reel.render?.lambda;
    if (!lambda?.renderId || !lambda?.bucketName || !lambda?.functionName || !lambda?.region) {
      return formatJSONResponse({
        data: {
          message: "Reel does not have an AWS render attached.",
          reel: await withAssetDownloadUrls(reel),
        },
      });
    }

    if (reel.status === "rendered") {
      return formatJSONResponse({
        data: {
          message: "Render already completed.",
          progress: reel.render?.progress,
          reel: await withAssetDownloadUrls(reel),
        },
      });
    }

    const progress = await getSwipe2PlayRenderProgress({
      bucketName: lambda.bucketName,
      functionName: lambda.functionName,
      region: lambda.region,
      renderId: lambda.renderId,
    });

    const now = new Date().toISOString();

    if (progress.fatalErrorEncountered) {
      const errorMessage =
        progress.errors?.map((error) => error.message).filter(Boolean).join("\n") ||
        "Remotion Lambda render failed.";
      const updatedReel = await dynamo.update({
        id: reelId,
        tableName: getReelJobsTableName(),
        data: {
          error: errorMessage,
          render: {
            ...reel.render,
            lambda: {
              ...lambda,
              progress: progress.overallProgress,
            },
            progress,
          },
          status: "failed",
          updatedAt: now,
        },
      });

      return formatJSONResponse({
        statusCode: 500,
        data: {
          message: errorMessage,
          progress,
          reel: await withAssetDownloadUrls(updatedReel),
        },
      });
    }

    if (progress.done) {
      const outKey = progress.outKey || lambda.outKey;
      const outBucket =
        progress.outBucket || lambda.outputBucket || progress.bucket || lambda.bucketName;
      const existingAssets = Array.isArray(reel.assets) ? reel.assets : [];
      const renderedAsset = {
        bucket: outBucket,
        contentType: "video/mp4",
        fileName: reel.render?.fileName || `${reelId}.mp4`,
        key: outKey,
        kind: "rendered-reel",
        sizeBytes: progress.outputSizeInBytes || undefined,
        uploadedAt: now,
      };
      const nextAssets = [
        ...existingAssets.filter((asset: Record<string, any>) => asset.kind !== "rendered-reel"),
        renderedAsset,
      ];

      const updatedReel = await dynamo.update({
        id: reelId,
        tableName: getReelJobsTableName(),
        data: {
          assets: nextAssets,
          render: {
            ...reel.render,
            lambda: {
              ...lambda,
              bucketName: outBucket,
              outputFile: progress.outputFile,
              outKey,
              progress: 1,
            },
            progress,
            sizeBytes: progress.outputSizeInBytes || undefined,
          },
          status: "rendered",
          updatedAt: now,
        },
      });

      return formatJSONResponse({
        data: {
          message: "Render completed.",
          progress,
          reel: await withAssetDownloadUrls(updatedReel),
        },
      });
    }

    const updatedReel = await dynamo.update({
      id: reelId,
      tableName: getReelJobsTableName(),
      data: {
        render: {
          ...reel.render,
          lambda: {
            ...lambda,
            progress: progress.overallProgress,
          },
          progress: {
            done: false,
            overallProgress: progress.overallProgress,
            framesRendered: progress.framesRendered,
            lambdasInvoked: progress.lambdasInvoked,
            costs: progress.costs,
          },
        },
        status: "rendering",
        updatedAt: now,
      },
    });

    return formatJSONResponse({
      statusCode: 202,
      data: {
        message: "Render still running.",
        progress,
        reel: await withAssetDownloadUrls(updatedReel),
      },
    });
  } catch (err) {
    console.log(err);
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message:
          err instanceof Error ? err.message : "Unable to check render progress.",
      },
    });
  }
};
