import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { getReelJobsTableName } from "@libs/reelJobs";

const allowedUpdateKeys = [
  "assets",
  "caption",
  "error",
  "publishResults",
  "publishTargets",
  "render",
  "segments",
  "source",
  "status",
  "templateId",
  "title",
  "uploads",
];

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const reelId = event.pathParameters?.reelId;
    const body = event.body ? JSON.parse(event.body) : {};

    if (!reelId) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Missing reelId path parameter.",
        },
      });
    }

    const updates = allowedUpdateKeys.reduce<Record<string, any>>((data, key) => {
      if (body[key] !== undefined) data[key] = body[key];
      return data;
    }, {});

    updates.updatedAt = new Date().toISOString();

    const reel = await dynamo.update({
      id: reelId,
      tableName: getReelJobsTableName(),
      data: updates,
    });

    return formatJSONResponse({
      data: {
        message: "Reel job updated successfully.",
        reel,
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
