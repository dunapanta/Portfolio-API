import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  buildTweetActivity,
  getTweetActivityTableName,
} from "@libs/tweetActivity";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const activity = buildTweetActivity(body);

    await dynamo.write(activity, getTweetActivityTableName());

    return formatJSONResponse({
      statusCode: 201,
      data: {
        activity,
        message: "Activity saved. It will feed the tweet generator.",
      },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to save activity." },
    });
  }
};
