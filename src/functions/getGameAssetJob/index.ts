import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { createSpriteAssetDownloadUrl, getSpriteAssetJob } from "@libs/spriteAssetJobs";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const accessKey = process.env.SPRITE_STUDIO_KEY || "daniel";
    if (String(event.queryStringParameters?.key || "") !== accessKey) {
      return formatJSONResponse({ statusCode: 401, data: { message: "Invalid access key." } });
    }
    const jobId = String(event.pathParameters?.jobId || "");
    const job = await getSpriteAssetJob(jobId);
    if (!job) return formatJSONResponse({ statusCode: 404, data: { message: "Generation job not found." } });
    return formatJSONResponse({
      data: {
        jobId: job.id,
        status: job.status,
        model: job.model,
        revisedPrompt: job.revisedPrompt,
        imageUrl: job.resultKey ? await createSpriteAssetDownloadUrl(job.resultKey) : undefined,
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

