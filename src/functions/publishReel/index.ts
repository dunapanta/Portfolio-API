import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { getReelJobsTableName } from "@libs/reelJobs";
import {
  InstagramPublishResult,
  PublishPlatform,
  publishReelToPlatform,
} from "@libs/reelPublishing";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const reelId = event.pathParameters?.reelId;
    const body = event.body ? JSON.parse(event.body) : {};
    const platform = body.platform as PublishPlatform | undefined;

    if (!reelId) {
      return formatJSONResponse({
        statusCode: 400,
        data: { message: "Missing reelId path parameter." },
      });
    }

    if (
      platform !== "facebook" &&
      platform !== "instagram" &&
      platform !== "youtube" &&
      platform !== "x"
    ) {
      return formatJSONResponse({
        statusCode: 400,
        data: { message: "platform must be facebook, instagram, youtube, or x." },
      });
    }

    const reel = await dynamo.get(reelId, getReelJobsTableName());
    if (!reel) {
      return formatJSONResponse({
        statusCode: 404,
        data: { message: "Reel job not found." },
      });
    }

    const result = await publishReelToPlatform({
      metadata: body,
      platform,
      reel,
    });

    const resultStatus = (result as InstagramPublishResult).status;
    const isInstagramProcessing = resultStatus === "processing";
    const publishResults =
      typeof reel.publishResults === "object" && reel.publishResults
        ? reel.publishResults
        : {};
    const nextPublishResults = {
      ...publishResults,
      [platform]: {
        ...result,
        ...(isInstagramProcessing
          ? { updatedAt: new Date().toISOString() }
          : { publishedAt: new Date().toISOString() }),
      },
    };

    const updatedReel = await dynamo.update({
      id: reelId,
      tableName: getReelJobsTableName(),
      data: {
        publishResults: nextPublishResults,
        status: isInstagramProcessing ? "publishing" : "published",
        updatedAt: new Date().toISOString(),
      },
    });

    return formatJSONResponse({
      statusCode: isInstagramProcessing ? 202 : 200,
      data: {
        message: isInstagramProcessing
          ? (result as InstagramPublishResult).message
          : `${platform} publish completed.`,
        reel: updatedReel,
        result,
      },
    });
  } catch (error) {
    console.log(error);
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: error instanceof Error ? error.message : "Unable to publish reel.",
      },
    });
  }
};
