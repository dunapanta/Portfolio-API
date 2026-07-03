import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  facebookConnectionId,
  getSocialConnectionsTableName,
} from "@libs/facebookOAuth";

export const handler = async (_event: APIGatewayProxyEvent) => {
  try {
    const connection = await dynamo.get(facebookConnectionId, getSocialConnectionsTableName());
    const expiresAt =
      typeof connection?.expiresAt === "number" ? connection.expiresAt : undefined;
    const expired = expiresAt ? expiresAt <= Math.floor(Date.now() / 1000) : true;
    const connected = Boolean(connection?.pageAccessToken && !expired);

    return formatJSONResponse({
      data: {
        connected,
        expiresAt,
        instagramBusinessAccountId: connection?.instagramBusinessAccountId,
        message: connected
          ? "Facebook is connected through Dynamo."
          : "Connect Facebook to store a Page token in Dynamo.",
        pageId: connection?.pageId,
        pageName: connection?.pageName,
      },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: error instanceof Error ? error.message : "Unable to read Facebook status.",
      },
    });
  }
};
