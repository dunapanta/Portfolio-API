import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import {
  assertCreativeStudioAccess,
  creativeStudioErrorStatus,
  deleteCreativeProject,
  listCreativeProjects,
  loadCreativeProject,
  saveCreativeProject,
} from "@libs/creativeStudio";

const methodOf = (event: APIGatewayProxyEvent) =>
  event.httpMethod || (event.requestContext as any)?.http?.method || "GET";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const ownerId = assertCreativeStudioAccess(event);
    const method = methodOf(event);
    const projectId = event.pathParameters?.projectId;
    if (method === "GET" && projectId) {
      return formatJSONResponse({ data: { project: await loadCreativeProject(ownerId, projectId) } });
    }
    if (method === "GET") {
      return formatJSONResponse({ data: { projects: await listCreativeProjects(ownerId) } });
    }
    if ((method === "POST" || method === "PATCH")) {
      const body = event.body ? JSON.parse(event.body) : {};
      const project = await saveCreativeProject({ ownerId, projectId, project: body.project });
      return formatJSONResponse({ statusCode: method === "POST" ? 201 : 200, data: { project } });
    }
    if (method === "DELETE" && projectId) {
      await deleteCreativeProject(ownerId, projectId);
      return formatJSONResponse({ data: { deleted: true } });
    }
    return formatJSONResponse({ statusCode: 405, data: { message: "Method not allowed." } });
  } catch (error) {
    return formatJSONResponse({
      statusCode: creativeStudioErrorStatus(error),
      data: { message: error instanceof Error ? error.message : "Unable to manage creative project." },
    });
  }
};
