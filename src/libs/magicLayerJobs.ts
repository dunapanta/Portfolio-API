import { createHash, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import { APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

export class MagicLayerAccessError extends Error {
  constructor() {
    super("Invalid LayerLab access key.");
    this.name = "MagicLayerAccessError";
  }
}

export const assertMagicLayerAccess = (event: Pick<APIGatewayProxyEvent, "headers">) => {
  const expected = process.env.MAGIC_LAYERS_ACCESS_KEY;
  if (!expected) throw new Error("LayerLab access key is not configured.");
  const provided = Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === "x-magic-layers-key")?.[1] || "";
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    throw new MagicLayerAccessError();
  }
};

export const magicLayerErrorStatus = (error: unknown) => error instanceof MagicLayerAccessError ? 401 : 400;

export type MagicLayerJob = {
  id: string;
  token: string;
  status: "uploading" | "queued" | "processing" | "ready" | "failed";
  inputKey: string;
  resultKey?: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
  error?: string;
};

const tableName = () => {
  if (!process.env.magicLayerJobsTable) throw new Error("Missing magicLayerJobsTable env var.");
  return process.env.magicLayerJobsTable;
};

const bucketName = () => {
  if (!process.env.gameMediaBucket) throw new Error("Missing gameMediaBucket env var.");
  return process.env.gameMediaBucket;
};

export const createMagicLayerJobId = () => randomUUID();
export const createMagicLayerToken = () => randomBytes(24).toString("base64url");

export const assertMagicLayerDailyLimit = async (sourceIp: string) => {
  const date = new Date().toISOString().slice(0, 10);
  const ipHash = createHash("sha256").update(sourceIp || "unknown").digest("hex").slice(0, 24);
  const id = `rate:${date}:${ipHash}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60;
  try {
    await db.send(new UpdateCommand({
      TableName: tableName(),
      Key: { id },
      UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :one, expiresAt = :expiresAt",
      ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":limit": 4, ":expiresAt": expiresAt },
    }));
  } catch (error) {
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
      throw new Error("Daily local-AI limit reached. Try again tomorrow.");
    }
    throw error;
  }
};

export const createMagicLayerJob = async (job: MagicLayerJob) => {
  await db.send(new PutCommand({ TableName: tableName(), Item: job }));
};

export const getMagicLayerJob = async (id: string) => {
  const response = await db.send(new GetCommand({ TableName: tableName(), Key: { id } }));
  return response.Item as MagicLayerJob | undefined;
};

export const requireMagicLayerJob = async (id: string, token: string) => {
  const job = await getMagicLayerJob(id);
  if (!job || !token || job.token !== token) throw new Error("Layer job not found.");
  return job;
};

export const updateMagicLayerJob = async (id: string, values: Partial<MagicLayerJob>) => {
  const entries = Object.entries({ ...values, updatedAt: new Date().toISOString() }).filter(([, value]) => value !== undefined);
  const names = Object.fromEntries(entries.map(([key], index) => [`#k${index}`, key]));
  const attributes = Object.fromEntries(entries.map(([, value], index) => [`:v${index}`, value]));
  await db.send(new UpdateCommand({
    TableName: tableName(),
    Key: { id },
    UpdateExpression: `SET ${entries.map(([,], index) => `#k${index} = :v${index}`).join(", ")}`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: attributes,
  }));
};

export const createMagicLayerUploadUrl = (key: string, contentType: string) =>
  getSignedUrl(s3, new PutObjectCommand({ Bucket: bucketName(), Key: key, ContentType: contentType }), { expiresIn: 15 * 60 });

export const assertMagicLayerUpload = async (job: MagicLayerJob) => {
  const object = await s3.send(new HeadObjectCommand({ Bucket: bucketName(), Key: job.inputKey }));
  if (!object.ContentLength || object.ContentLength > 10 * 1024 * 1024) throw new Error("Uploaded image is missing or too large.");
};

export const readMagicLayerManifest = async (key: string) => {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucketName(), Key: key }));
  if (!response.Body) throw new Error("Layer manifest is empty.");
  return JSON.parse(await response.Body.transformToString()) as {
    width: number;
    height: number;
    backgroundKey: string;
    layers: Array<{ key: string; name: string; x: number; y: number; width: number; height: number }>;
  };
};

export const createMagicLayerDownloadUrl = (key: string) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName(), Key: key }), { expiresIn: 30 * 60 });
