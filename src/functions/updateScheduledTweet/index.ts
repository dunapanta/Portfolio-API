import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  buildScheduledTweetPatch,
  getScheduledTweetsTableName,
  ScheduledTweet,
} from "@libs/scheduledTweets";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const tweetId = event.pathParameters?.tweetId;
    if (!tweetId) throw new Error("tweetId is required.");

    const table = getScheduledTweetsTableName();
    const existing = (await dynamo.get(tweetId, table)) as ScheduledTweet | undefined;
    if (!existing) throw new Error("Tweet not found.");
    if (existing.status === "posted" || existing.status === "publishing") {
      throw new Error("Cannot edit a tweet that is already posting or posted.");
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const patch = buildScheduledTweetPatch(body);
    const tweet = await dynamo.update({ id: tweetId, tableName: table, data: patch });

    return formatJSONResponse({ data: { message: "Tweet updated.", tweet } });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to update tweet." },
    });
  }
};
