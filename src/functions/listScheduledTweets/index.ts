import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { listRecentTweets, ScheduledTweet } from "@libs/scheduledTweets";
import { withTweetMediaDownloadUrl } from "@libs/tweetMedia";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 100, 200);
    const tweets = await listRecentTweets(limit);

    const withUrls = await Promise.all(
      tweets.map(async (tweet: ScheduledTweet) => ({
        ...tweet,
        media: tweet.media
          ? await Promise.all(tweet.media.map((m) => withTweetMediaDownloadUrl(m)))
          : undefined,
      }))
    );

    return formatJSONResponse({
      data: { message: "Scheduled tweets retrieved.", tweets: withUrls },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 500,
      data: { message: error instanceof Error ? error.message : "Unable to load tweets." },
    });
  }
};
