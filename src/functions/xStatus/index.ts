import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { getSocialConnectionsTableName } from "@libs/facebookOAuth";
import { getXConfig, xConnectionId } from "@libs/xOAuth";

export const handler = async (_event: APIGatewayProxyEvent) => {
  try {
    let configured = true;
    let configMessage = "X OAuth is configured.";

    try {
      getXConfig();
    } catch (configError) {
      configured = false;
      configMessage = configError instanceof Error ? configError.message : "X OAuth is not configured.";
    }

    const connection = await dynamo.get(xConnectionId, getSocialConnectionsTableName());
    const connected = Boolean(connection?.refreshToken);

    return formatJSONResponse({
      data: {
        configured,
        connected,
        message: connected
          ? "X is connected through Dynamo."
          : configured
          ? "Connect X to store a refresh token in Dynamo."
          : configMessage,
      },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: error instanceof Error ? error.message : "Unable to read X status.",
      },
    });
  }
};
