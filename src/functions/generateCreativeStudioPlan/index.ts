import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import {
  assertCreativeGenerationLimit,
  assertCreativeStudioAccess,
  creativeDownloadUrl,
  creativeStudioErrorStatus,
  generateCreativePlan,
} from "@libs/creativeStudio";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const ownerId = assertCreativeStudioAccess(event);
    const body = event.body ? JSON.parse(event.body) : {};
    const topic = String(body.topic || "").trim();
    if (topic.length < 5 || topic.length > 1200) throw new Error("Describe the topic in 5 to 1200 characters.");
    const slideCount = Math.min(10, Math.max(2, Number(body.slideCount) || 7));
    const keys = Array.isArray(body.referenceKeys) ? body.referenceKeys.slice(0, 4) : [];
    const expectedPrefix = `carousel-studio/${ownerId}/`;
    if (keys.some((key: unknown) => typeof key !== "string" || !key.startsWith(expectedPrefix))) {
      throw new Error("One or more reference assets are invalid.");
    }
    await assertCreativeGenerationLimit(ownerId);
    const result = await generateCreativePlan({
      topic,
      audience: String(body.audience || "").slice(0, 500),
      goal: String(body.goal || "educate").slice(0, 120),
      tone: String(body.tone || "clear and energetic").slice(0, 120),
      platform: ["instagram", "tiktok", "app-store"].includes(body.platform) ? body.platform : "instagram",
      slideCount,
      style: String(body.style || "bold-utility").slice(0, 120),
      brandNotes: String(body.brandNotes || "").slice(0, 800),
      referenceUrls: await Promise.all(keys.map((key: string) => creativeDownloadUrl(key))),
    });
    return formatJSONResponse({ data: result });
  } catch (error) {
    return formatJSONResponse({
      statusCode: creativeStudioErrorStatus(error),
      data: { message: error instanceof Error ? error.message : "Unable to generate creative plan." },
    });
  }
};
