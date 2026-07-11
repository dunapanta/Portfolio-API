import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  buildScheduledTweet,
  getScheduledTweetsTableName,
} from "@libs/scheduledTweets";
import {
  getTweetActivityTableName,
} from "@libs/tweetActivity";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const tweet = buildScheduledTweet(body);

    await dynamo.write(tweet, getScheduledTweetsTableName());

    // Mark the source activity as used so planDailyTweets doesn't reuse it.
    if (tweet.sourceActivityId) {
      await dynamo
        .update({
          id: tweet.sourceActivityId,
          tableName: getTweetActivityTableName(),
          data: { status: "used", updatedAt: new Date().toISOString() },
        })
        .catch(() => undefined);
    }

    return formatJSONResponse({
      statusCode: 201,
      data: { message: "Tweet scheduled.", tweet },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to schedule tweet." },
    });
  }
};
