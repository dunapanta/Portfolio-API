import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { getSocialConnectionsTableName } from "@libs/facebookOAuth";
import { getXConfig, xConnectionId } from "@libs/xOAuth";
import { getOpenAiConfig } from "@libs/openAi";
import { listRecentTweets } from "@libs/scheduledTweets";
import { getTweetMediaTtlDays } from "@libs/tweetActivity";

export const handler = async (_event: APIGatewayProxyEvent) => {
  try {
    let xConfigured = true;
    let configMessage = "X OAuth is configured.";
    try {
      getXConfig();
    } catch (configError) {
      xConfigured = false;
      configMessage =
        configError instanceof Error ? configError.message : "X OAuth is not configured.";
    }

    const connection = await dynamo.get(
      xConnectionId,
      getSocialConnectionsTableName()
    );
    const connected = Boolean((connection as { refreshToken?: string })?.refreshToken);
    const scope = (connection as { scope?: string })?.scope || "";
    const canPostMedia = scope.includes("media.write");

    const recent = await listRecentTweets(100);
    const counts = recent.reduce(
      (acc, tweet) => {
        acc[tweet.status] = (acc[tweet.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    return formatJSONResponse({
      data: {
        canPostMedia,
        configured: xConfigured,
        connected,
        counts,
        dailyTarget: Number(process.env.TWEET_STUDIO_DAILY_TARGET || 2),
        mediaTtlDays: getTweetMediaTtlDays(),
        message: connected
          ? canPostMedia
            ? "X connected with media upload enabled."
            : "X connected, but reconnect to enable media.write for images/video."
          : xConfigured
          ? "Connect X to start scheduling tweets."
          : configMessage,
        openAiModel: process.env.OPENAI_TWEET_MODEL || getOpenAiConfig().defaultModel,
        slots: (process.env.TWEET_STUDIO_SLOTS || "13:00,20:00").split(","),
        timezone: process.env.TWEET_STUDIO_TIMEZONE || "America/Guayaquil",
      },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: error instanceof Error ? error.message : "Unable to read status.",
      },
    });
  }
};
