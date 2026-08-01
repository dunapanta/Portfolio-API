import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { assertCreativeStudioAccess, creativeStudioErrorStatus } from "@libs/creativeStudio";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    assertCreativeStudioAccess(event);
    return formatJSONResponse({ data: { authorized: true } });
  } catch (error) {
    return formatJSONResponse({
      statusCode: creativeStudioErrorStatus(error),
      data: { authorized: false, message: error instanceof Error ? error.message : "Access denied." },
    });
  }
};
