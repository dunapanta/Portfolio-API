import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { getTweetActivityTableName, TweetActivity } from "@libs/tweetActivity";
import { withTweetMediaDownloadUrl } from "@libs/tweetMedia";

export const handler = async (_event: APIGatewayProxyEvent) => {
  try {
    const { items } = await dynamo.queryPage({
      tableName: getTweetActivityTableName(),
      index: "GSI-activity-recent",
      pkKey: "entity",
      pkValue: "activity",
      limit: 100,
      sortAscending: false,
    });

    const activities = await Promise.all(
      (items as TweetActivity[]).map(async (activity) => ({
        ...activity,
        media: activity.media
          ? await Promise.all(activity.media.map((m) => withTweetMediaDownloadUrl(m)))
          : undefined,
      }))
    );

    return formatJSONResponse({
      data: {
        activities,
        message: "Tweet activity log retrieved.",
      },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 500,
      data: { message: error instanceof Error ? error.message : "Unable to load activity." },
    });
  }
};
