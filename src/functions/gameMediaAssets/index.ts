import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  createGameMediaId,
  createGameMediaKey,
  createGameMediaUploadUrl,
  deleteGameMediaObject,
  getGameMediaAssetsTableName,
  getGameMediaBucketName,
  normalizeGameMediaKind,
  Swipe2PlayGameMediaAsset,
  withGameMediaDownloadUrl,
} from "@libs/gameMedia";
import { getGameContextsTableName } from "@libs/gameContexts";

const mediaByGameIndexName = "GSI-game-media-by-game";

const parseNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

const parseBody = (event: APIGatewayProxyEvent) =>
  event.body ? JSON.parse(event.body) : {};

const getMethod = (event: APIGatewayProxyEvent) =>
  event.httpMethod || (event.requestContext as any).http?.method || "GET";

const listMedia = async (gameId: string) => {
  const media = (await dynamo.query({
    index: mediaByGameIndexName,
    pkKey: "gameId",
    pkValue: gameId,
    sortAscending: false,
    tableName: getGameMediaAssetsTableName(),
  })) as Swipe2PlayGameMediaAsset[];

  const assets = await Promise.all(
    media.map((asset) => withGameMediaDownloadUrl(asset))
  );

  return assets.sort((a, b) => {
    if (a.mediaKind !== b.mediaKind) return a.mediaKind.localeCompare(b.mediaKind);
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
};

const createMediaUpload = async (gameId: string, body: Record<string, unknown>) => {
  const game = await dynamo.get(gameId, getGameContextsTableName());
  if (!game) throw new Error("Game context not found.");

  const fileName = String(body.fileName || "clip.mp4").trim();
  const contentType = String(body.contentType || "video/mp4").trim();
  const mediaKind = normalizeGameMediaKind(body.mediaKind);
  const mediaId = createGameMediaId();
  const key = createGameMediaKey({
    fileName,
    gameId,
    mediaId,
    mediaKind,
  });
  const now = new Date().toISOString();
  const asset: Swipe2PlayGameMediaAsset = {
    bucket: getGameMediaBucketName(),
    contentType,
    createdAt: now,
    durationSeconds: parseNumber(body.durationSeconds),
    fileName,
    gameId,
    height: parseNumber(body.height),
    id: mediaId,
    key,
    label: typeof body.label === "string" ? body.label.trim() : undefined,
    mediaKind,
    sizeBytes: parseNumber(body.sizeBytes),
    status: "uploading",
    updatedAt: now,
    width: parseNumber(body.width),
  };

  await dynamo.write(asset, getGameMediaAssetsTableName());

  return {
    asset: await withGameMediaDownloadUrl(asset),
    uploadUrl: await createGameMediaUploadUrl({
      contentType,
      key,
    }),
  };
};

const updateMedia = async (
  gameId: string,
  mediaId: string,
  body: Record<string, unknown>
) => {
  const existing = (await dynamo.get(
    mediaId,
    getGameMediaAssetsTableName()
  )) as Swipe2PlayGameMediaAsset | undefined;

  if (!existing || existing.gameId !== gameId) throw new Error("Game media asset not found.");

  const updated = (await dynamo.update({
    data: {
      durationSeconds: parseNumber(body.durationSeconds),
      height: parseNumber(body.height),
      label: typeof body.label === "string" ? body.label.trim() : undefined,
      sizeBytes: parseNumber(body.sizeBytes),
      status: body.status === "uploading" ? "uploading" : "ready",
      updatedAt: new Date().toISOString(),
      width: parseNumber(body.width),
    },
    id: mediaId,
    tableName: getGameMediaAssetsTableName(),
  })) as Swipe2PlayGameMediaAsset;

  return withGameMediaDownloadUrl(updated);
};

const deleteMedia = async (gameId: string, mediaId: string) => {
  const existing = (await dynamo.get(
    mediaId,
    getGameMediaAssetsTableName()
  )) as Swipe2PlayGameMediaAsset | undefined;

  if (!existing || existing.gameId !== gameId) throw new Error("Game media asset not found.");

  await deleteGameMediaObject(existing.key);
  await dynamo.delete(mediaId, getGameMediaAssetsTableName());

  return existing;
};

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const gameId = event.pathParameters?.gameId;
    const mediaId = event.pathParameters?.mediaId;
    const method = getMethod(event);

    if (!gameId) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Missing gameId path parameter.",
        },
      });
    }

    if (method === "GET") {
      return formatJSONResponse({
        data: {
          assets: await listMedia(gameId),
          message: "Game media assets retrieved successfully.",
        },
      });
    }

    if (method === "POST") {
      const data = await createMediaUpload(gameId, parseBody(event));

      return formatJSONResponse({
        data: {
          ...data,
          message: "Game media upload URL created successfully.",
        },
      });
    }

    if (method === "PATCH" && mediaId) {
      const asset = await updateMedia(gameId, mediaId, parseBody(event));

      return formatJSONResponse({
        data: {
          asset,
          message: "Game media asset updated successfully.",
        },
      });
    }

    if (method === "DELETE" && mediaId) {
      const asset = await deleteMedia(gameId, mediaId);

      return formatJSONResponse({
        data: {
          asset,
          message: "Game media asset deleted successfully.",
        },
      });
    }

    return formatJSONResponse({
      statusCode: 405,
      data: {
        message: "Method not allowed for game media assets.",
      },
    });
  } catch (err) {
    console.log(err);
    const message = err instanceof Error ? err.message : "Unable to manage game media asset.";
    const statusCode =
      message.includes("not found") || message.includes("not configured")
        ? 404
        : message.includes("mediaKind") || message.includes("Missing")
          ? 400
          : 500;

    return formatJSONResponse({
      statusCode,
      data: {
        message,
      },
    });
  }
};
