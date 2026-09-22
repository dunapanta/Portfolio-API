import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});
const table = () => {
  if (!process.env.spriteGenJobsTable) throw new Error("spriteGenJobsTable is not configured.");
  return process.env.spriteGenJobsTable;
};
const bucket = () => {
  if (!process.env.spriteAssetsBucket) throw new Error("spriteAssetsBucket is not configured.");
  return process.env.spriteAssetsBucket;
};

export type SpriteGenJob = {
  id: string;
  ownerId: string;
  status: "queued" | "processing" | "ready" | "failed";
  stage: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  style: string;
  direction: string;
  model: string;
  quality: string;
  states: string[];
  referenceKey?: string;
  resultPrefix: string;
  costUsd?: number;
  costStatus?: string;
  stateCosts?: Record<string, unknown>;
  files?: Record<string, string>;
  error?: string;
};

export const newSpriteGenJobId = () => randomUUID();
export const createSpriteGenJob = async (job: SpriteGenJob) => {
  await db.send(new PutCommand({ TableName: table(), Item: job, ConditionExpression: "attribute_not_exists(id)" }));
};
export const getSpriteGenJob = async (id: string) => {
  const result = await db.send(new GetCommand({ TableName: table(), Key: { id } }));
  return result.Item as SpriteGenJob | undefined;
};
export const failSpriteGenJob = async (id: string, error: string) => {
  await db.send(new UpdateCommand({
    TableName: table(), Key: { id },
    UpdateExpression: "SET #s = :s, #stage = :stage, #error = :error, updatedAt = :updatedAt",
    ExpressionAttributeNames: { "#s": "status", "#stage": "stage", "#error": "error" },
    ExpressionAttributeValues: { ":s": "failed", ":stage": "failed", ":error": error, ":updatedAt": new Date().toISOString() },
  }));
};
export const putSpriteGenReference = async (key: string, bytes: Buffer, contentType: string) => {
  await s3.send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: bytes, ContentType: contentType }));
};
export const spriteGenDownloadUrl = (key: string) => getSignedUrl(
  s3, new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: 15 * 60 }
);
