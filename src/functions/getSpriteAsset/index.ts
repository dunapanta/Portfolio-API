import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import {
  createSpriteLibraryFileUrl,
  getSpriteLibraryAsset,
  spriteAssetOwnerId,
} from "@libs/spriteAssets";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const accessKey = process.env.SPRITE_STUDIO_KEY || "daniel";
    if (String(event.queryStringParameters?.key || "") !== accessKey) {
      return formatJSONResponse({ statusCode: 401, data: { message: "Invalid access key." } });
    }
    const asset = await getSpriteLibraryAsset(String(event.pathParameters?.assetId || ""));
    if (!asset || asset.ownerId !== spriteAssetOwnerId(accessKey)) {
      return formatJSONResponse({ statusCode: 404, data: { message: "Asset not found." } });
    }
    return formatJSONResponse({
      data: {
        asset: { ...asset, ownerId: undefined, storageKey: undefined },
        fileUrl: await createSpriteLibraryFileUrl(asset.storageKey),
      },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to open the asset." },
    });
  }
};

