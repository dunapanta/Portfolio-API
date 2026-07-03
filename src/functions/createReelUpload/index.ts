import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  createAssetKey,
  createUploadUrl,
  getReelJobsTableName,
  ReelAssetKind,
} from "@libs/reelJobs";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const reelId = event.pathParameters?.reelId;
    const body = event.body ? JSON.parse(event.body) : {};
    const {
      contentType = "video/mp4",
      fileName = "asset.mp4",
      kind = "manual-video",
    }: {
      contentType?: string;
      fileName?: string;
      kind?: ReelAssetKind;
    } = body;

    if (!reelId) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Missing reelId path parameter.",
        },
      });
    }

    const existing = await dynamo.get(reelId, getReelJobsTableName());
    if (!existing) {
      return formatJSONResponse({
        statusCode: 404,
        data: {
          message: "Reel job not found.",
        },
      });
    }

    const key = createAssetKey({
      reelId,
      kind,
      fileName,
    });
    const uploadUrl = await createUploadUrl({
      key,
      contentType,
    });

    return formatJSONResponse({
      data: {
        contentType,
        fileName,
        kind,
        key,
        uploadUrl,
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
