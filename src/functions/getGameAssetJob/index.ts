import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { createSpriteAssetDownloadUrl, getSpriteAssetJob } from "@libs/spriteAssetJobs";
import { createSpriteLibraryFileUrl } from "@libs/spriteAssets";
import { validateSpriteStudioAccessKey } from "@libs/spriteStudioAuth";
import { RIG_PART_LAYOUT } from "@libs/gameAssetGenerator";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    if (!validateSpriteStudioAccessKey(event.queryStringParameters?.key)) {
      return formatJSONResponse({ statusCode: 401, data: { message: "Invalid access key." } });
    }
    const jobId = String(event.pathParameters?.jobId || "");
    const job = await getSpriteAssetJob(jobId);
    if (!job) return formatJSONResponse({ statusCode: 404, data: { message: "Generation job not found." } });
    return formatJSONResponse({
      data: {
        jobId: job.id,
        assetId: job.assetId,
        status: job.status,
        model: job.model,
        revisedPrompt: job.revisedPrompt,
        workflow: job.workflow,
        direction: job.direction,
        rigLayout: job.workflow === "parts" ? RIG_PART_LAYOUT : undefined,
        imageUrl: job.resultKey
          ? await (job.assetId
            ? createSpriteLibraryFileUrl(job.resultKey)
            : createSpriteAssetDownloadUrl(job.resultKey))
          : undefined,
        message: job.error,
      },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to read generation status." },
    });
  }
};
