import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getOpenAiApiKey } from "@libs/openAi";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

export class CreativeStudioAccessError extends Error {
  constructor() {
    super("Invalid SwipeForge access key.");
    this.name = "CreativeStudioAccessError";
  }
}

export type CreativeProjectRecord = {
  id: string;
  ownerId: string;
  title: string;
  topic: string;
  platform: "instagram" | "tiktok" | "app-store";
  templateId: string;
  slideCount: number;
  projectKey: string;
  coverKey?: string;
  createdAt: string;
  updatedAt: string;
};

const tableName = () => {
  if (!process.env.creativeProjectsTable) throw new Error("Creative projects table is not configured.");
  return process.env.creativeProjectsTable;
};

const bucketName = () => {
  if (!process.env.gameMediaBucket) throw new Error("Creative assets bucket is not configured.");
  return process.env.gameMediaBucket;
};

const headerValue = (event: Pick<APIGatewayProxyEvent, "headers">, name: string) =>
  Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] || "";

export const assertCreativeStudioAccess = (event: Pick<APIGatewayProxyEvent, "headers">) => {
  const expected = process.env.CREATIVE_STUDIO_ACCESS_KEY;
  if (!expected) throw new Error("SwipeForge access key is not configured.");
  const provided = headerValue(event, "x-creative-studio-key");
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    throw new CreativeStudioAccessError();
  }
  return createHash("sha256").update(expected).digest("hex").slice(0, 24);
};

export const creativeStudioErrorStatus = (error: unknown) => {
  if (error instanceof CreativeStudioAccessError) return 401;
  const message = error instanceof Error ? error.message : "";
  if (message.includes("not found")) return 404;
  return 400;
};

export const createCreativeProjectId = () => randomUUID();

const safeFileName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-90) || "asset.png";

export const projectPrefix = (ownerId: string, projectId: string) =>
  `carousel-studio/${ownerId}/${projectId}`;

export const createCreativeUpload = async (input: {
  ownerId: string;
  projectId: string;
  fileName: string;
  contentType: string;
  kind: "asset" | "cover" | "export";
}) => {
  const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowed.has(input.contentType)) throw new Error("Only PNG, JPEG and WebP images are supported.");
  if (!/^[a-f0-9-]{20,}$/i.test(input.projectId)) throw new Error("Invalid project id.");
  const key = `${projectPrefix(input.ownerId, input.projectId)}/${input.kind}s/${randomUUID()}-${safeFileName(input.fileName)}`;
  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: bucketName(), Key: key, ContentType: input.contentType }),
    { expiresIn: 15 * 60 }
  );
  return { key, uploadUrl };
};

export const creativeDownloadUrl = (key: string) => {
  if (!key.startsWith("carousel-studio/")) throw new Error("Invalid creative asset key.");
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucketName(), Key: key }), { expiresIn: 60 * 60 });
};

const assertOwnedKey = (key: unknown, ownerId: string, projectId: string) => {
  if (typeof key !== "string" || !key.startsWith(`${projectPrefix(ownerId, projectId)}/`)) {
    throw new Error("Project contains an invalid asset key.");
  }
  return key;
};

const sanitizeProject = (project: any, ownerId: string, projectId: string) => {
  if (!project || typeof project !== "object") throw new Error("Project data is required.");
  const slides = Array.isArray(project.slides) ? project.slides : [];
  if (slides.length < 2 || slides.length > 10) throw new Error("A project must contain between 2 and 10 slides.");
  const assets = Array.isArray(project.assets) ? project.assets.slice(0, 30) : [];
  const exports = Array.isArray(project.exports) ? project.exports.slice(0, 10) : [];
  const sanitizedAssets = assets.map((asset: any) => ({
    id: String(asset.id || randomUUID()).slice(0, 80),
    name: String(asset.name || "Asset").slice(0, 120),
    key: assertOwnedKey(asset.key, ownerId, projectId),
    contentType: String(asset.contentType || "image/png").slice(0, 40),
  }));
  const sanitizedExports = exports.map((asset: any) => ({
    slideId: String(asset.slideId || "").slice(0, 80),
    key: assertOwnedKey(asset.key, ownerId, projectId),
  }));
  const safe = {
    ...project,
    id: projectId,
    assets: sanitizedAssets,
    exports: sanitizedExports,
    slides,
  };
  const serialized = JSON.stringify(safe);
  if (Buffer.byteLength(serialized) > 850_000) throw new Error("Project is too large to save.");
  return { safe, serialized };
};

export const saveCreativeProject = async (input: {
  ownerId: string;
  projectId?: string;
  project: any;
}) => {
  const requestedProjectId = String(input.project?.id || "").trim();
  const projectId =
    input.projectId ||
    (/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,80}$/.test(requestedProjectId)
      ? requestedProjectId
      : createCreativeProjectId());
  const existing = input.projectId ? await getCreativeProjectRecord(projectId) : undefined;
  if (existing && existing.ownerId !== input.ownerId) throw new Error("Creative project not found.");
  const { safe, serialized } = sanitizeProject(input.project, input.ownerId, projectId);
  const projectKey = `${projectPrefix(input.ownerId, projectId)}/project.json`;
  const coverKey = safe.coverKey ? assertOwnedKey(safe.coverKey, input.ownerId, projectId) : undefined;
  await s3.send(new PutObjectCommand({
    Bucket: bucketName(),
    Key: projectKey,
    Body: serialized,
    ContentType: "application/json",
  }));
  const now = new Date().toISOString();
  const platform = ["instagram", "tiktok", "app-store"].includes(safe.platform) ? safe.platform : "instagram";
  const record: CreativeProjectRecord = {
    id: projectId,
    ownerId: input.ownerId,
    title: String(safe.title || safe.topic || "Untitled carousel").slice(0, 140),
    topic: String(safe.topic || "").slice(0, 500),
    platform,
    templateId: String(safe.templateId || "bold-utility").slice(0, 80),
    slideCount: safe.slides.length,
    projectKey,
    coverKey,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await db.send(new PutCommand({ TableName: tableName(), Item: record }));
  return withCreativeProjectUrls(record);
};

export const getCreativeProjectRecord = async (id: string) => {
  const result = await db.send(new GetCommand({ TableName: tableName(), Key: { id } }));
  return result.Item as CreativeProjectRecord | undefined;
};

const withCreativeProjectUrls = async (record: CreativeProjectRecord) => ({
  ...record,
  ownerId: undefined,
  projectKey: undefined,
  coverUrl: record.coverKey ? await creativeDownloadUrl(record.coverKey) : undefined,
  coverKey: undefined,
});

export const listCreativeProjects = async (ownerId: string) => {
  const result = await db.send(new QueryCommand({
    TableName: tableName(),
    IndexName: "GSI-creative-projects-by-owner",
    KeyConditionExpression: "ownerId = :ownerId",
    ExpressionAttributeValues: { ":ownerId": ownerId },
    ScanIndexForward: false,
    Limit: 60,
  }));
  return Promise.all(((result.Items || []) as CreativeProjectRecord[]).map(withCreativeProjectUrls));
};

export const loadCreativeProject = async (ownerId: string, id: string) => {
  const record = await getCreativeProjectRecord(id);
  if (!record || record.ownerId !== ownerId) throw new Error("Creative project not found.");
  const result = await s3.send(new GetObjectCommand({ Bucket: bucketName(), Key: record.projectKey }));
  if (!result.Body) throw new Error("Creative project file not found.");
  const project = JSON.parse(await result.Body.transformToString());
  const assets = await Promise.all((project.assets || []).map(async (asset: any) => ({
    ...asset,
    url: await creativeDownloadUrl(asset.key),
  })));
  const exports = await Promise.all((project.exports || []).map(async (asset: any) => ({
    ...asset,
    url: await creativeDownloadUrl(asset.key),
  })));
  return { ...project, assets, exports };
};

export const deleteCreativeProject = async (ownerId: string, id: string) => {
  const record = await getCreativeProjectRecord(id);
  if (!record || record.ownerId !== ownerId) throw new Error("Creative project not found.");
  const prefix = `${projectPrefix(ownerId, id)}/`;
  let token: string | undefined;
  do {
    const result = await s3.send(new ListObjectsV2Command({
      Bucket: bucketName(), Prefix: prefix, ContinuationToken: token,
    }));
    const objects = (result.Contents || []).flatMap((object) => object.Key ? [{ Key: object.Key }] : []);
    if (objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: bucketName(), Delete: { Objects: objects } }));
    token = result.NextContinuationToken;
  } while (token);
  await db.send(new DeleteCommand({ TableName: tableName(), Key: { id } }));
};

export const assertCreativeGenerationLimit = async (ownerId: string) => {
  const date = new Date().toISOString().slice(0, 10);
  const id = `rate:${date}:${ownerId}`;
  try {
    await db.send(new UpdateCommand({
      TableName: tableName(),
      Key: { id },
      UpdateExpression: "SET #count = if_not_exists(#count, :zero) + :one, expiresAt = :expiresAt",
      ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
      ExpressionAttributeNames: { "#count": "count" },
      ExpressionAttributeValues: {
        ":zero": 0, ":one": 1, ":limit": 25,
        ":expiresAt": Math.floor(Date.now() / 1000) + 2 * 24 * 60 * 60,
      },
    }));
  } catch (error) {
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
      throw new Error("Daily AI generation limit reached. Try again tomorrow.");
    }
    throw error;
  }
};

const carouselSchema = (slideCount: number) => ({
  type: "object",
  additionalProperties: false,
  required: ["projectTitle", "strategy", "caption", "hashtags", "recommendedTemplate", "creativeDirection", "slides"],
  properties: {
    projectTitle: { type: "string", maxLength: 100 },
    strategy: { type: "string", maxLength: 500 },
    caption: { type: "string", maxLength: 1800 },
    hashtags: { type: "array", minItems: 3, maxItems: 8, items: { type: "string", maxLength: 40 } },
    recommendedTemplate: {
      type: "string",
      enum: [
        "editorial", "bold-utility", "soft-product", "neo-brutal", "cinematic", "playful", "panorama", "app-showcase",
        "beauty-editorial", "neon-intelligence", "culture-cutout", "story-pop", "focus-red", "premium-pink",
        "sky-learning", "performance-pro", "vision-board",
      ],
    },
    creativeDirection: {
      type: "object",
      additionalProperties: false,
      required: ["mood", "palette", "typeStyle", "motif"],
      properties: {
        mood: { type: "string", maxLength: 160 },
        palette: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" } },
        typeStyle: { type: "string", maxLength: 120 },
        motif: { type: "string", maxLength: 160 },
      },
    },
    slides: {
      type: "array",
      minItems: slideCount,
      maxItems: slideCount,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "eyebrow", "headline", "body", "cta", "visualDirection", "layout"],
        properties: {
          role: { type: "string", enum: ["hook", "context", "value", "proof", "reset", "payoff", "cta"] },
          eyebrow: { type: "string", maxLength: 42 },
          headline: { type: "string", maxLength: 90 },
          body: { type: "string", maxLength: 260 },
          cta: { type: "string", maxLength: 70 },
          visualDirection: { type: "string", maxLength: 220 },
          layout: { type: "string", enum: ["hero", "split", "quote", "steps", "device", "statement", "checklist", "cta"] },
        },
      },
    },
  },
});

const extractResponseText = (data: any) => {
  for (const output of data?.output || []) {
    for (const content of output?.content || []) {
      if (content?.type === "output_text" && content.text) return content.text;
      if (content?.type === "refusal" && content.refusal) throw new Error(content.refusal);
    }
  }
  throw new Error("OpenAI returned no carousel plan.");
};

export const generateCreativePlan = async (input: {
  topic: string;
  audience: string;
  goal: string;
  tone: string;
  platform: string;
  slideCount: number;
  style: string;
  brandNotes: string;
  referenceUrls: string[];
}) => {
  const apiKey = await getOpenAiApiKey();
  const model = process.env.CREATIVE_STUDIO_MODEL || "gpt-5.6-terra";
  const fallbackModel = process.env.OPENAI_DEFAULT_MODEL || "gpt-5.4-mini";
  const content: any[] = [{
    type: "input_text",
    text: [
      `Create an original ${input.slideCount}-slide ${input.platform} carousel plan.`,
      `Topic: ${input.topic}`,
      `Audience: ${input.audience || "general audience"}`,
      `Goal: ${input.goal}`,
      `Tone: ${input.tone}`,
      `Preferred visual style: ${input.style}`,
      `Brand notes: ${input.brandNotes || "none"}`,
      "Use the references only to infer palette, mood and subject matter. Never copy a composition, logo, phrase or branded template.",
      "Optimize for immediate comprehension, continuous storytelling, specific saveable value and an earned CTA. Slide 1 and slide 2 must both work as hooks.",
      input.platform === "app-store"
        ? "For App Store, communicate one app benefit per slide, reserve a device area for real UI, and make the first three slides express the core value. Alternate hero devices, tilted close-ups, proof moments and visual resets; favor the richer App Store scene families when they fit the brand."
        : "Keep copy concise enough for large mobile typography. Do not invent facts, testimonials or statistics.",
    ].join("\n"),
  }];
  for (const url of input.referenceUrls.slice(0, 4)) {
    content.push({ type: "input_image", image_url: url, detail: "low" });
  }
  const request = async (selectedModel: string) => {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        reasoning: { effort: "none" },
        input: [{ role: "user", content }],
        max_output_tokens: 5000,
        store: false,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "carousel_plan",
            strict: true,
            schema: carouselSchema(input.slideCount),
          },
        },
      }),
    });
    const data = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw Object.assign(new Error(data?.error?.message || "Unable to generate carousel plan."), { status: response.status });
    return { plan: JSON.parse(extractResponseText(data)), model: data.model || selectedModel, usage: data.usage };
  };
  try {
    return await request(model);
  } catch (error) {
    if (model !== fallbackModel && [400, 404].includes(Number((error as any)?.status))) {
      return request(fallbackModel);
    }
    throw error;
  }
};
