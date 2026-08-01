import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import {
  assertCreativeStudioAccess,
  createCreativeUpload,
  creativeStudioErrorStatus,
} from "@libs/creativeStudio";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const ownerId = assertCreativeStudioAccess(event);
    const body = event.body ? JSON.parse(event.body) : {};
    const kind = ["asset", "cover", "export"].includes(body.kind) ? body.kind : "asset";
    const upload = await createCreativeUpload({
      ownerId,
      projectId: String(body.projectId || ""),
      fileName: String(body.fileName || "asset.png"),
      contentType: String(body.contentType || "image/png"),
      kind,
    });
    return formatJSONResponse({ statusCode: 201, data: upload });
  } catch (error) {
    return formatJSONResponse({
      statusCode: creativeStudioErrorStatus(error),
      data: { message: error instanceof Error ? error.message : "Unable to create upload." },
    });
  }
};
