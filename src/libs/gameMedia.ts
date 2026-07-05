import { randomUUID } from "crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});
const signedUrlSeconds = 15 * 60;

export type Swipe2PlayGameMediaKind = "gameplay" | "hook";

export type Swipe2PlayGameMediaAsset = {
  bucket: string;
  contentType: string;
  createdAt: string;
  downloadUrl?: string;
  durationSeconds?: number;
  fileName: string;
  gameId: string;
  height?: number;
  id: string;
  key: string;
  label?: string;
  mediaKind: Swipe2PlayGameMediaKind;
  sizeBytes?: number;
  status: "ready" | "uploading";
  updatedAt: string;
  width?: number;
};

export const getGameMediaAssetsTableName = () => {
  const tableName = process.env.gameMediaAssetsTable;
  if (!tableName) throw new Error("Missing gameMediaAssetsTable env var.");
  return tableName;
};

export const getGameMediaBucketName = () => {
  const bucketName = process.env.gameMediaBucket;
  if (!bucketName) throw new Error("Missing gameMediaBucket env var.");
  return bucketName;
};

export const createGameMediaId = () => randomUUID();

const sanitizePart = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120);

export const normalizeGameMediaKind = (value: unknown): Swipe2PlayGameMediaKind => {
  const mediaKind = String(value || "").toLowerCase().trim();
  if (mediaKind !== "hook" && mediaKind !== "gameplay") {
    throw new Error("mediaKind must be hook or gameplay.");
  }

  return mediaKind;
};

export const createGameMediaKey = ({
  fileName,
  gameId,
  mediaId,
  mediaKind,
}: {
  fileName: string;
  gameId: string;
  mediaId: string;
  mediaKind: Swipe2PlayGameMediaKind;
}) => {
  const safeGameId = sanitizePart(gameId) || "game";
  const safeFileName = sanitizePart(fileName) || "clip.mp4";

  return `swipe2play/games/${safeGameId}/${mediaKind}/${mediaId}-${safeFileName}`;
};

export const createGameMediaUploadUrl = async ({
  contentType,
  key,
}: {
  contentType: string;
  key: string;
}) => {
  const command = new PutObjectCommand({
    Bucket: getGameMediaBucketName(),
    ContentType: contentType,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn: signedUrlSeconds });
};

export const createGameMediaDownloadUrl = async (key: string) => {
  const command = new GetObjectCommand({
    Bucket: getGameMediaBucketName(),
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn: signedUrlSeconds });
};

export const deleteGameMediaObject = async (key: string) => {
  const command = new DeleteObjectCommand({
    Bucket: getGameMediaBucketName(),
    Key: key,
  });

  await s3.send(command);
};

export const withGameMediaDownloadUrl = async <Asset extends { key?: string }>(
  asset: Asset
) => ({
  ...asset,
  downloadUrl: asset.key ? await createGameMediaDownloadUrl(asset.key) : undefined,
});
