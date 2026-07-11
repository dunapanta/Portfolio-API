import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { getTweetActivityTableName } from "@libs/tweetActivity";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const activityId = event.pathParameters?.activityId;
    if (!activityId) throw new Error("activityId is required.");

    await dynamo.delete(activityId, getTweetActivityTableName());

    return formatJSONResponse({
      data: { id: activityId, message: "Activity deleted." },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to delete activity." },
    });
  }
};
