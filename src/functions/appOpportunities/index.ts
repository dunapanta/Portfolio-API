import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  AppOpportunityAccessError,
  appOpportunityErrorStatus,
  assertAppOpportunityAccess,
  OpportunityRecord,
  saveOpportunitySnapshots,
} from "@libs/appOpportunities";

const methodOf = (event: APIGatewayProxyEvent) =>
  event.httpMethod || (event.requestContext as any)?.http?.method || "GET";

const tableName = () => {
  if (!process.env.appOpportunitiesTable) throw new Error("Missing appOpportunitiesTable env var.");
  return process.env.appOpportunitiesTable;
};
export const handler = async (event: APIGatewayProxyEvent) => {
  const method = methodOf(event);
  try {
    assertAppOpportunityAccess(event);
    if (method === "POST") {
      const body = event.body ? JSON.parse(event.body) : {};
      const result = await saveOpportunitySnapshots({
        capturedAt: body.capturedAt,
        opportunities: body.opportunities,
        runId: body.runId,
      });
      return formatJSONResponse({
        statusCode: 201,
        data: { ...result, message: "Opportunity snapshots saved." },
      });
    }
    if (method === "GET") {
      const view = event.queryStringParameters?.view === "history" ? "SNAPSHOT" : "LATEST";
      const requestedLimit = Number(event.queryStringParameters?.limit || (view === "LATEST" ? 500 : 1000));
      const limit = Math.round(Math.min(1000, Math.max(1, requestedLimit || 500)));
      const { items, nextToken } = await dynamo.queryPage({
        tableName: tableName(),
        index: "GSI-app-opportunities-recent",
        pkKey: "entity",
        pkValue: view,
        limit,
        nextToken: event.queryStringParameters?.nextToken,
        sortAscending: false,
      });
      const store = String(event.queryStringParameters?.store || "").toLowerCase();
      const keyword = String(event.queryStringParameters?.keyword || "").trim().toLocaleLowerCase();
      const verdict = String(event.queryStringParameters?.verdict || "").toLowerCase();
      const filtered = (items as OpportunityRecord[]).filter((item) =>
        (!store || item.store === store) &&
        (!keyword || item.normalizedKeyword.includes(keyword)) &&
        (!verdict || item.verdict === verdict)
      );
      return formatJSONResponse({
        data: {
          items: filtered,
          nextToken,
          view: view.toLocaleLowerCase(),
        },
      });
    }
    return formatJSONResponse({ statusCode: 405, data: { message: "Method not allowed." } });
  } catch (error) {
    const statusCode = error instanceof AppOpportunityAccessError
      ? appOpportunityErrorStatus(error)
      : method === "POST"
        ? 400
        : 500;
    return formatJSONResponse({
      statusCode,
      data: { message: error instanceof Error ? error.message : "Unable to manage opportunities." },
    });
  }
};
