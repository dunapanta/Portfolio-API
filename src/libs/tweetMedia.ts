import { randomUUID } from "crypto";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});
const signedUrlSeconds = 15 * 60;

export type TweetMediaKind = "image" | "video";

export const getTweetMediaBucketName = () => {
  const bucketName = process.env.tweetMediaBucket;
  if (!bucketName) throw new Error("Missing tweetMediaBucket env var.");
  return bucketName;
};

const sanitizePart = (value: string) =>
  value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 120);

export const inferTweetMediaKind = (contentType: string): TweetMediaKind =>
  contentType.toLowerCase().startsWith("video/") ? "video" : "image";

export const createTweetMediaKey = ({
  contentType,
  fileName,
}: {
  contentType: string;
  fileName: string;
}) => {
  const kind = inferTweetMediaKind(contentType);
  const safeName = sanitizePart(fileName) || (kind === "video" ? "clip.mp4" : "image.png");
  const today = new Date().toISOString().slice(0, 10);
  return `tweet-studio/${today}/${kind}/${randomUUID()}-${safeName}`;
};

export const createTweetMediaUploadUrl = async ({
  contentType,
  key,
}: {
  contentType: string;
  key: string;
}) => {
  const command = new PutObjectCommand({
    Bucket: getTweetMediaBucketName(),
    ContentType: contentType,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: signedUrlSeconds });
};

export const createTweetMediaDownloadUrl = async (key: string) => {
  const command = new GetObjectCommand({
    Bucket: getTweetMediaBucketName(),
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn: signedUrlSeconds });
};

/** Read a media object back from S3 into memory to push it to X. */
export const getTweetMediaObject = async (
  key: string
): Promise<{ buffer: Buffer; contentType: string }> => {
  const command = new GetObjectCommand({
    Bucket: getTweetMediaBucketName(),
    Key: key,
  });
  const response = await s3.send(command);
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Unable to read media object ${key} from S3.`);
  return {
    buffer: Buffer.from(bytes),
    contentType: response.ContentType || "application/octet-stream",
  };
};

export const withTweetMediaDownloadUrl = async <Item extends { key?: string }>(
  item: Item
) => ({
  ...item,
  downloadUrl: item.key ? await createTweetMediaDownloadUrl(item.key) : undefined,
});
