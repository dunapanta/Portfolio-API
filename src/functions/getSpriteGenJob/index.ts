import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { validateSpriteGenAccess } from "@libs/spriteGenAuth";
import { spriteAssetOwnerId } from "@libs/spriteAssets";
import { getSpriteGenJob, spriteGenDownloadUrl } from "@libs/spriteGenJobs";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const accessKey = await validateSpriteGenAccess(event.headers?.["x-sprite-studio-key"] || event.headers?.["X-Sprite-Studio-Key"]);
    if (!accessKey) return formatJSONResponse({ statusCode: 401, data: { message: "Clave de acceso incorrecta." } });
    const job = await getSpriteGenJob(String(event.pathParameters?.jobId || ""));
    if (!job || job.ownerId !== spriteAssetOwnerId(accessKey)) {
      return formatJSONResponse({ statusCode: 404, data: { message: "Trabajo no encontrado." } });
    }
    const files = job.status === "ready" && job.files
      ? Object.fromEntries(await Promise.all(Object.entries(job.files).map(async ([name, key]) => [name, await spriteGenDownloadUrl(key)])))
      : undefined;
    return formatJSONResponse({ data: {
      jobId: job.id, status: job.status, stage: job.stage, createdAt: job.createdAt,
      model: job.model, quality: job.quality, states: job.states, costUsd: job.costUsd,
      costStatus: job.costStatus, stateCosts: job.stateCosts, files, message: job.error,
    } });
  } catch (error) {
    return formatJSONResponse({ statusCode: 400, data: { message: error instanceof Error ? error.message : "No se pudo consultar el trabajo." } });
  }
};
