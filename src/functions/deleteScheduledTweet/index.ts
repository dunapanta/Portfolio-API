import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { getScheduledTweetsTableName } from "@libs/scheduledTweets";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const tweetId = event.pathParameters?.tweetId;
    if (!tweetId) throw new Error("tweetId is required.");

    await dynamo.delete(tweetId, getScheduledTweetsTableName());

    return formatJSONResponse({ data: { id: tweetId, message: "Tweet deleted." } });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to delete tweet." },
    });
  }
};
