import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  getScheduledTweetsTableName,
  ScheduledTweet,
} from "@libs/scheduledTweets";
import { publishTweetRecord } from "@libs/tweetPublisher";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const tweetId = event.pathParameters?.tweetId;
    if (!tweetId) throw new Error("tweetId is required.");

    const existing = (await dynamo.get(
      tweetId,
      getScheduledTweetsTableName()
    )) as ScheduledTweet | undefined;
    if (!existing) throw new Error("Tweet not found.");
    if (existing.status === "posted") {
      throw new Error("This tweet was already posted.");
    }

    const result = await publishTweetRecord(existing);
    const publishError = (result as ScheduledTweet & { publishError?: string })
      .publishError;

    if (publishError) {
      return formatJSONResponse({
        statusCode: 502,
        data: { message: publishError, tweet: result },
      });
    }

    return formatJSONResponse({
      data: { message: "Tweet published to X.", tweet: result },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to publish tweet." },
    });
  }
};
