import { createHash, randomUUID } from "crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

const s3 = new S3Client({});
const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export type SpriteAssetKind = "image" | "rig";

export type SpriteLibraryAsset = {
  id: string;
  ownerId: string;
  kind: SpriteAssetKind;
  assetType: string;
  description: string;
  style: string;
  workflow: string;
  model: string;
  movements: string[];
  storageKey: string;
  contentType: string;
  createdAt: string;
  updatedAt: string;
};

const tableName = () => {
  if (!process.env.spriteAssetsTable) throw new Error("Missing spriteAssetsTable env var.");
  return process.env.spriteAssetsTable;
};

const bucketName = () => {
  if (!process.env.spriteAssetsBucket) throw new Error("Missing spriteAssetsBucket env var.");
  return process.env.spriteAssetsBucket;
};

export const spriteAssetOwnerId = (accessKey: string) =>
  createHash("sha256").update(accessKey).digest("hex").slice(0, 24);

export const createSpriteLibraryAssetId = () => randomUUID();

export const createSpriteLibraryAsset = async (asset: SpriteLibraryAsset) => {
  await db.send(new PutCommand({ TableName: tableName(), Item: asset }));
};

export const getSpriteLibraryAsset = async (id: string) => {
  const response = await db.send(new GetCommand({ TableName: tableName(), Key: { id } }));
  return response.Item as SpriteLibraryAsset | undefined;
};

export const listSpriteLibraryAssets = async (ownerId: string, limit = 60) => {
  const response = await db.send(
    new QueryCommand({
      TableName: tableName(),
      IndexName: "GSI-sprite-assets-by-owner",
      KeyConditionExpression: "ownerId = :ownerId",
      ExpressionAttributeValues: { ":ownerId": ownerId },
      ScanIndexForward: false,
      Limit: Math.min(Math.max(limit, 1), 100),
    })
  );
  return (response.Items || []) as SpriteLibraryAsset[];
};

export const putSpriteLibraryObject = async ({
  body,
  contentType,
  key,
}: {
  body: Buffer | Uint8Array | string;
  contentType: string;
  key: string;
}) => {
  await s3.send(
    new PutObjectCommand({ Bucket: bucketName(), Key: key, Body: body, ContentType: contentType })
  );
};

export const createSpriteLibraryFileUrl = (key: string) =>
  getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName(), Key: key }), { expiresIn: 15 * 60 });

