import { randomUUID } from "crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const s3 = new S3Client({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export type SpriteAssetJobStatus = "queued" | "processing" | "ready" | "failed";

export type SpriteAssetJob = {
  id: string;
  status: SpriteAssetJobStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
  assetType: string;
  workflow?: string;
  direction?: string;
  model?: string;
  revisedPrompt?: string;
  resultKey?: string;
  assetId?: string;
  error?: string;
};

const tableName = () => {
  if (!process.env.spriteAssetJobsTable) throw new Error("Missing spriteAssetJobsTable env var.");
  return process.env.spriteAssetJobsTable;
};

const bucketName = () => {
  if (!process.env.gameMediaBucket) throw new Error("Missing gameMediaBucket env var.");
  return process.env.gameMediaBucket;
};

export const createSpriteAssetJobId = () => randomUUID();

export const createSpriteAssetJob = async (job: SpriteAssetJob) => {
  await db.send(new PutCommand({ TableName: tableName(), Item: job }));
};

export const getSpriteAssetJob = async (id: string) => {
  const response = await db.send(new GetCommand({ TableName: tableName(), Key: { id } }));
  return response.Item as SpriteAssetJob | undefined;
};

export const updateSpriteAssetJob = async (
  id: string,
  values: Partial<Pick<SpriteAssetJob, "status" | "model" | "revisedPrompt" | "resultKey" | "assetId" | "error" | "workflow" | "direction">>
) => {
  const entries = Object.entries({ ...values, updatedAt: new Date().toISOString() }).filter(
    ([, value]) => value !== undefined
  );
  const names = Object.fromEntries(entries.map(([key], index) => [`#k${index}`, key]));
  const attributes = Object.fromEntries(entries.map(([, value], index) => [`:v${index}`, value]));
  await db.send(
    new UpdateCommand({
      TableName: tableName(),
      Key: { id },
      UpdateExpression: `SET ${entries.map(([,], index) => `#k${index} = :v${index}`).join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: attributes,
    })
  );
};

export const putSpriteAssetObject = async ({
  body,
  contentType,
  key,
}: {
  body: Buffer | Uint8Array;
  contentType: string;
  key: string;
}) => {
  await s3.send(
    new PutObjectCommand({ Bucket: bucketName(), Key: key, Body: body, ContentType: contentType })
  );
};

export const getSpriteAssetObject = async (key: string) => {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucketName(), Key: key }));
  if (!response.Body) throw new Error("Stored reference image is empty.");
  return Buffer.from(await response.Body.transformToByteArray());
};

export const createSpriteAssetDownloadUrl = (key: string) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName(), Key: key }), { expiresIn: 15 * 60 });
