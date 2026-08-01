import { APIGatewayProxyEvent } from "aws-lambda";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { assertMagicLayerAccess, assertMagicLayerUpload, magicLayerErrorStatus, requireMagicLayerJob, updateMagicLayerJob } from "@libs/magicLayerJobs";

const lambda = new LambdaClient({});

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    assertMagicLayerAccess(event);
    const body = event.body ? JSON.parse(event.body) : {};
    const jobId = String(event.pathParameters?.jobId || "");
    const job = await requireMagicLayerJob(jobId, String(body.token || ""));
    if (job.status !== "uploading") return formatJSONResponse({ statusCode: 202, data: { jobId, status: job.status } });
    await assertMagicLayerUpload(job);
    const maxIterations = Math.max(3, Math.min(12, Math.round(Number(body.maxIterations) || 10)));
    const workerName = process.env.MAGIC_LAYER_WORKER_FUNCTION_NAME;
    if (!workerName) throw new Error("Open-source layer worker is not configured.");
    await updateMagicLayerJob(jobId, { status: "queued" });
    await lambda.send(new InvokeCommand({
      FunctionName: workerName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ jobId, inputKey: job.inputKey, maxIterations })),
    }));
    return formatJSONResponse({ statusCode: 202, data: { jobId, status: "queued" } });
  } catch (error) {
    return formatJSONResponse({ statusCode: magicLayerErrorStatus(error), data: { message: error instanceof Error ? error.message : "Unable to start layer job." } });
  }
};
