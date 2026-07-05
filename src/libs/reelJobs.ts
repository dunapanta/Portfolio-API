import { randomUUID } from "crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type ReelJobStatus =
  | "draft"
  | "uploading"
  | "uploaded"
  | "rendering"
  | "rendered"
  | "publishing"
  | "published"
  | "failed";

export type ReelAssetKind =
  | "hook-video"
  | "hook-audio"
  | "gameplay-video"
  | "gameplay-audio"
  | "cta-video"
  | "cta-audio"
  | "rendered-video"
  | "manual-video"
  | "voiceover-audio";

export type ReelUploadRequest = {
  contentType?: string;
  fileName?: string;
  kind?: ReelAssetKind;
};

const s3 = new S3Client({});
const defaultTtlDays = 7;
const signedUrlSeconds = 15 * 60;

export const getReelJobsTableName = () => {
  if (!process.env.reelJobsTable) throw new Error("Missing reelJobsTable env var.");
  return process.env.reelJobsTable;
};

export const getReelAssetsBucketName = () => {
  if (!process.env.reelAssetsBucket) throw new Error("Missing reelAssetsBucket env var.");
  return process.env.reelAssetsBucket;
};

export const getReelExpiry = () => {
  const ttlDays = Number(process.env.reelAssetTtlDays ?? defaultTtlDays);
  const safeTtlDays = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : defaultTtlDays;
  return Math.floor(Date.now() / 1000) + safeTtlDays * 24 * 60 * 60;
};

export const createReelId = () => randomUUID();

export const createAssetKey = ({
  reelId,
  kind = "manual-video",
  fileName = "asset.mp4",
}: {
  reelId: string;
  kind?: ReelAssetKind;
  fileName?: string;
}) => {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "asset.mp4";
  return `swipe2play/reels/${reelId}/${kind}/${Date.now()}-${safeFileName}`;
};

export const createUploadUrl = async ({
  key,
  contentType = "video/mp4",
}: {
  key: string;
  contentType?: string;
}) => {
  const command = new PutObjectCommand({
    Bucket: getReelAssetsBucketName(),
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3, command, { expiresIn: signedUrlSeconds });
};

export const createDownloadUrl = async (key: string, bucketName = getReelAssetsBucketName()) => {
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn: signedUrlSeconds });
};

export const putReelAssetObject = async ({
  body,
  contentType,
  key,
}: {
  body: Buffer | Uint8Array;
  contentType: string;
  key: string;
}) => {
  const command = new PutObjectCommand({
    Body: body,
    Bucket: getReelAssetsBucketName(),
    ContentType: contentType,
    Key: key,
  });

  await s3.send(command);
};
