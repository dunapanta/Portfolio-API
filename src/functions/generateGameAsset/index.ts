import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  createSpriteAssetJob,
  createSpriteAssetJobId,
  putSpriteAssetObject,
  updateSpriteAssetJob,
} from "@libs/spriteAssetJobs";

const lambda = new LambdaClient({});

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const accessKey = process.env.SPRITE_STUDIO_KEY || "daniel";
    if (String(body.key || "") !== accessKey) {
      return formatJSONResponse({ statusCode: 401, data: { message: "Invalid access key." } });
    }
    const description = String(body.description || "").trim();
    if (!description) {
      return formatJSONResponse({ statusCode: 400, data: { message: "Describe the asset first." } });
    }
    if (description.length > 900) {
      return formatJSONResponse({ statusCode: 400, data: { message: "Description is too long (max 900 characters)." } });
    }
    const referenceImage = body.referenceImage ? String(body.referenceImage) : undefined;
    if (referenceImage && referenceImage.length > 5_600_000) {
      return formatJSONResponse({ statusCode: 400, data: { message: "Reference image is too large (max 4 MB)." } });
    }
    const jobId = createSpriteAssetJobId();
    let referenceKey: string | undefined;
    if (referenceImage) {
      const match = referenceImage.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
      if (!match) {
        return formatJSONResponse({ statusCode: 400, data: { message: "Reference must be a PNG, JPEG or WebP image." } });
      }
      const extension = match[1].toLowerCase().replace("jpeg", "jpg");
      referenceKey = `sprite-forge/jobs/${jobId}/reference.${extension}`;
      await putSpriteAssetObject({
        body: Buffer.from(match[2], "base64"),
        contentType: extension === "jpg" ? "image/jpeg" : `image/${extension}`,
        key: referenceKey,
      });
    }

    const input = {
      description,
      assetType: String(body.assetType || "character"),
      style: String(body.style || "cartoon"),
      workflow: String(body.workflow || "single"),
      model: String(body.model || "gpt-image-2"),
      movements: Array.isArray(body.movements) ? body.movements.map(String).slice(0, 20) : [],
      referenceKey,
    };
    const now = new Date().toISOString();
    await createSpriteAssetJob({
      id: jobId,
      status: "queued",
      assetType: input.assetType,
      createdAt: now,
      updatedAt: now,
      expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    });

    const workerName = process.env.SPRITE_ASSET_WORKER_FUNCTION_NAME;
    if (!workerName) throw new Error("Sprite asset worker is not configured.");
    try {
      await lambda.send(
        new InvokeCommand({
          FunctionName: workerName,
          InvocationType: "Event",
          Payload: Buffer.from(JSON.stringify({ jobId, input })),
        })
      );
    } catch (error) {
      await updateSpriteAssetJob(jobId, {
        status: "failed",
        error: error instanceof Error ? error.message : "Unable to start generation.",
      });
      throw error;
    }
    return formatJSONResponse({ statusCode: 202, data: { jobId, status: "queued", message: "Asset generation started." } });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to generate the asset." },
    });
  }
};
