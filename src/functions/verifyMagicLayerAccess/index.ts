import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { assertMagicLayerAccess, magicLayerErrorStatus } from "@libs/magicLayerJobs";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    assertMagicLayerAccess(event);
    return formatJSONResponse({ data: { authorized: true } });
  } catch (error) {
    return formatJSONResponse({
      statusCode: magicLayerErrorStatus(error),
      data: { message: error instanceof Error ? error.message : "Unable to verify LayerLab access." },
    });
  }
};
