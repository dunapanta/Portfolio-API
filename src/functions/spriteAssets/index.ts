import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import {
  createSpriteLibraryAsset,
  createSpriteLibraryAssetId,
  createSpriteLibraryFileUrl,
  listSpriteLibraryAssets,
  putSpriteLibraryObject,
  spriteAssetOwnerId,
} from "@libs/spriteAssets";

const validAccessKey = (value: unknown) => {
  const accessKey = process.env.SPRITE_STUDIO_KEY || "daniel";
  return String(value || "") === accessKey ? accessKey : null;
};

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const method = event.httpMethod || (event as any).requestContext?.http?.method;
    if (method === "GET") {
      const accessKey = validAccessKey(event.queryStringParameters?.key);
      if (!accessKey) {
        return formatJSONResponse({ statusCode: 401, data: { message: "Invalid access key." } });
      }
      const assets = await listSpriteLibraryAssets(spriteAssetOwnerId(accessKey));
      return formatJSONResponse({
        data: {
          assets: await Promise.all(
            assets.map(async (asset) => ({
              ...asset,
              ownerId: undefined,
              storageKey: undefined,
              imageUrl: asset.kind === "image"
                ? await createSpriteLibraryFileUrl(asset.storageKey)
                : undefined,
            }))
          ),
        },
      });
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const accessKey = validAccessKey(body.key);
    if (!accessKey) {
      return formatJSONResponse({ statusCode: 401, data: { message: "Invalid access key." } });
    }
    const savedProject = body.project && typeof body.project === "object" ? body.project : null;
    const savedSpec = body.spec && typeof body.spec === "object" ? body.spec : null;
    const payload = savedProject || savedSpec;
    if (body.kind !== "rig" || !payload) {
      return formatJSONResponse({
        statusCode: 400,
        data: { message: "Only generated rig or image-motion projects can be saved here." },
      });
    }
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized) > 6_000_000) {
      return formatJSONResponse({ statusCode: 400, data: { message: "Rig project is too large." } });
    }
    const id = createSpriteLibraryAssetId();
    const ownerId = spriteAssetOwnerId(accessKey);
    const storageKey = `sprite-forge/assets/${ownerId}/${id}/rig.json`;
    await putSpriteLibraryObject({ body: serialized, contentType: "application/json", key: storageKey });
    const now = new Date().toISOString();
    const asset = {
      id,
      ownerId,
      kind: "rig" as const,
      assetType: "character",
      description: String(body.description || "Generated character").slice(0, 900),
      style: String(body.style || "cartoon").slice(0, 40),
      workflow: savedProject ? "image-motion" : "rigged",
      model: String(body.model || "gpt-5.4-mini").slice(0, 80),
      movements: Array.isArray(body.movements) ? body.movements.map(String).slice(0, 20) : [],
      storageKey,
      contentType: "application/json",
      createdAt: now,
      updatedAt: now,
    };
    await createSpriteLibraryAsset(asset);
    return formatJSONResponse({
      statusCode: 201,
      data: { asset: { ...asset, ownerId: undefined, storageKey: undefined } },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to access the asset library." },
    });
  }
};
