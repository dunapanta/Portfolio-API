import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import {
  assertMagicLayerDailyLimit,
  assertMagicLayerAccess,
  createMagicLayerJob,
  createMagicLayerJobId,
  createMagicLayerToken,
  createMagicLayerUploadUrl,
  magicLayerErrorStatus,
} from "@libs/magicLayerJobs";

const contentTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    assertMagicLayerAccess(event);
    const body = event.body ? JSON.parse(event.body) : {};
    const contentType = String(body.contentType || "").toLowerCase();
    const size = Number(body.size);
    if (!contentTypes.has(contentType)) throw new Error("Use a PNG, JPEG or WebP image.");
    if (!Number.isFinite(size) || size <= 0 || size > 10 * 1024 * 1024) throw new Error("Image must be smaller than 10 MB.");
    const requestContext = event.requestContext as typeof event.requestContext & { http?: { sourceIp?: string } };
    const sourceIp = requestContext?.identity?.sourceIp || requestContext?.http?.sourceIp || "unknown";
    await assertMagicLayerDailyLimit(sourceIp);

    const jobId = createMagicLayerJobId();
    const token = createMagicLayerToken();
    const extension = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
    const inputKey = `magic-layers/jobs/${jobId}/input.${extension}`;
    const now = new Date().toISOString();
    await createMagicLayerJob({
      id: jobId,
      token,
      status: "uploading",
      inputKey,
      fileName: String(body.fileName || "image").slice(0, 180),
      contentType,
      size,
      createdAt: now,
      updatedAt: now,
      expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    });

    return formatJSONResponse({
      statusCode: 201,
      data: { jobId, token, uploadUrl: await createMagicLayerUploadUrl(inputKey, contentType) },
    });
  } catch (error) {
    return formatJSONResponse({ statusCode: magicLayerErrorStatus(error), data: { message: error instanceof Error ? error.message : "Unable to create layer job." } });
  }
};
