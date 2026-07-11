import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  getTweetActivityTableName,
  TweetActivity,
} from "@libs/tweetActivity";
import { generateTweetDrafts } from "@libs/tweetGenerator";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // Context can come from a stored activity record or be sent inline.
    let context: Record<string, unknown> = {};
    let sourceActivityId: string | undefined;

    if (body.activityId) {
      const activity = (await dynamo.get(
        String(body.activityId),
        getTweetActivityTableName()
      )) as TweetActivity | undefined;
      if (!activity) throw new Error("Activity record not found.");
      sourceActivityId = activity.id;
      context = {
        appId: activity.appId,
        context: activity.context,
        links: activity.links,
        tags: activity.tags,
        title: activity.title,
        toolsUsed: activity.toolsUsed,
        hasMedia: Boolean(activity.media?.length),
      };
    } else if (body.context) {
      context = {
        appId: body.appId,
        context: String(body.context),
        links: body.links,
        tags: body.tags,
        title: body.title,
        toolsUsed: body.toolsUsed,
      };
    } else {
      throw new Error("Provide activityId or context to generate tweets.");
    }

    const count = Math.min(Math.max(Number(body.count) || 3, 1), 6);
    const { drafts, model } = await generateTweetDrafts({
      context,
      count,
      formats: Array.isArray(body.formats) ? body.formats : undefined,
      tone: body.tone ? String(body.tone) : undefined,
    });

    return formatJSONResponse({
      data: {
        drafts,
        message: `Generated ${drafts.length} tweet drafts.`,
        model,
        sourceActivityId,
      },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to generate tweets." },
    });
  }
};
