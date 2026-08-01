import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import {
  appOpportunityErrorStatus,
  assertAppOpportunityAccess,
} from "@libs/appOpportunities";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    assertAppOpportunityAccess(event);
    return formatJSONResponse({ data: { authorized: true } });
  } catch (error) {
    return formatJSONResponse({
      statusCode: appOpportunityErrorStatus(error),
      data: {
        authorized: false,
        message: error instanceof Error ? error.message : "Access denied.",
      },
    });
  }
};
