import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { getSocialConnectionsTableName } from "@libs/facebookOAuth";
import { youtubeConnectionId } from "@libs/youtubeOAuth";

export const handler = async (_event: APIGatewayProxyEvent) => {
  try {
    const connection = await dynamo.get(youtubeConnectionId, getSocialConnectionsTableName());
    const connected = Boolean(connection?.refreshToken);

    return formatJSONResponse({
      data: {
        connected,
        message: connected
          ? "YouTube is connected through Dynamo."
          : "Connect YouTube to store a refresh token in Dynamo.",
      },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: error instanceof Error ? error.message : "Unable to read YouTube status.",
      },
    });
  }
};
