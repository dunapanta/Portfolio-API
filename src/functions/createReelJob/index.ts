import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  createAssetKey,
  createReelId,
  createUploadUrl,
  getReelExpiry,
  getReelJobsTableName,
  ReelUploadRequest,
} from "@libs/reelJobs";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { templateId, title, source = "manual", segments = [], publishTargets = [], uploads = [] } = body;

    if (!templateId) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Missing required parameter templateId.",
        },
      });
    }

    const id = createReelId();
    const now = new Date().toISOString();
    const expiresAt = getReelExpiry();
    const uploadRequests = Array.isArray(uploads) ? (uploads as ReelUploadRequest[]) : [];
    const uploadUrls = await Promise.all(
      uploadRequests.map(async (upload) => {
        const key = createAssetKey({
          reelId: id,
          kind: upload.kind,
          fileName: upload.fileName,
        });

        return {
          contentType: upload.contentType ?? "video/mp4",
          fileName: upload.fileName,
          kind: upload.kind ?? "manual-video",
          key,
          uploadUrl: await createUploadUrl({
            key,
            contentType: upload.contentType,
          }),
        };
      })
    );

    const reelJob = {
      id,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      publishTargets,
      segments,
      source,
      status: uploadUrls.length ? "uploading" : "draft",
      templateId,
      title,
      uploads: uploadUrls.map(({ uploadUrl, ...upload }) => upload),
    };

    await dynamo.write(reelJob, getReelJobsTableName());

    return formatJSONResponse({
      data: {
        message: "Reel job created successfully.",
        reel: reelJob,
        uploadUrls,
      },
    });
  } catch (err) {
    console.log(err);
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: err.message,
      },
    });
  }
};
