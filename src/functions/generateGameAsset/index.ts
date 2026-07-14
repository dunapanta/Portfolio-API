import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { generateGameAsset } from "@libs/gameAssetGenerator";

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
    const result = await generateGameAsset({
      description,
      assetType: String(body.assetType || "character"),
      style: String(body.style || "cartoon"),
      workflow: String(body.workflow || "single"),
      model: String(body.model || "gpt-image-2"),
      movements: Array.isArray(body.movements) ? body.movements.map(String).slice(0, 20) : [],
      referenceImage,
    });
    return formatJSONResponse({ data: { ...result, message: "Asset generated." } });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to generate the asset." },
    });
  }
};
