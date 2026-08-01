import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { assertMagicLayerAccess, createMagicLayerDownloadUrl, magicLayerErrorStatus, readMagicLayerManifest, requireMagicLayerJob } from "@libs/magicLayerJobs";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    assertMagicLayerAccess(event);
    const jobId = String(event.pathParameters?.jobId || "");
    const job = await requireMagicLayerJob(jobId, String(event.queryStringParameters?.token || ""));
    if (job.status !== "ready" || !job.resultKey) {
      return formatJSONResponse({ data: { jobId, status: job.status, message: job.error } });
    }
    const manifest = await readMagicLayerManifest(job.resultKey);
    return formatJSONResponse({ data: {
      jobId,
      status: "ready",
      width: manifest.width,
      height: manifest.height,
      backgroundUrl: await createMagicLayerDownloadUrl(manifest.backgroundKey),
      layers: await Promise.all(manifest.layers.map(async (layer) => ({ ...layer, url: await createMagicLayerDownloadUrl(layer.key) }))),
    } });
  } catch (error) {
    return formatJSONResponse({ statusCode: magicLayerErrorStatus(error), data: { message: error instanceof Error ? error.message : "Unable to read layer job." } });
  }
};
