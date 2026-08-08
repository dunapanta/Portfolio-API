import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

export const rematesTableName = () => {
  if (!process.env.rematesTable) throw new Error("Missing rematesTable environment variable.");
  return process.env.rematesTable;
};

export const rematesBucketName = () => {
  if (!process.env.rematesDocumentsBucket) throw new Error("Missing rematesDocumentsBucket environment variable.");
  return process.env.rematesDocumentsBucket;
};

export const rematesQueueUrl = () => {
  if (!process.env.rematesExtractionQueueUrl) throw new Error("Missing rematesExtractionQueueUrl environment variable.");
  return process.env.rematesExtractionQueueUrl;
};

const s3 = new S3Client({});
const sqs = new SQSClient({});

export const putRemateObject = async ({
  key,
  body,
  contentType,
}: {
  key: string;
  body: Buffer | string;
  contentType: string;
}) => {
  await s3.send(new PutObjectCommand({
    Bucket: rematesBucketName(),
    Key: key,
    Body: body,
    ContentType: contentType,
    ServerSideEncryption: "AES256",
  }));
};

export const getRemateObject = async (key: string) => {
  const response = await s3.send(new GetObjectCommand({ Bucket: rematesBucketName(), Key: key }));
  if (!response.Body) throw new Error(`Remates document ${key} has no body.`);
  return Buffer.from(await response.Body.transformToByteArray());
};

export const queueRemateExtraction = async (message: Record<string, unknown>) => {
  await sqs.send(new SendMessageCommand({
    QueueUrl: rematesQueueUrl(),
    MessageBody: JSON.stringify(message),
  }));
};
