import { randomUUID } from "crypto";

/**
 * A "registro" of what was built on a given day. This is the raw context that
 * feeds the OpenAI tweet generator. Kept small and TTL'd so it self-cleans.
 */
export type TweetActivityMedia = {
  contentType?: string;
  fileName?: string;
  key: string;
  kind?: "image" | "video";
  sizeBytes?: number;
};

export type TweetActivityStatus = "pending" | "used" | "archived";

export type TweetActivity = {
  // Fixed partition value so GSI-activity-recent can list everything by date.
  entity: "activity";
  appId?: string;
  context: string;
  createdAt: string;
  expiresAt: number;
  id: string;
  links?: string[];
  media?: TweetActivityMedia[];
  status: TweetActivityStatus;
  tags?: string[];
  title?: string;
  toolsUsed?: string[];
  updatedAt: string;
};

export const getTweetActivityTableName = () => {
  const tableName = process.env.tweetActivityTable;
  if (!tableName) throw new Error("Missing tweetActivityTable env var.");
  return tableName;
};

export const getTweetMediaTtlDays = () => {
  const parsed = Number(process.env.tweetMediaTtlDays);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
};

/** Unix seconds `days` from now, used for DynamoDB TTL + S3 lifecycle parity. */
export const ttlSecondsFromNow = (days = getTweetMediaTtlDays()) =>
  Math.floor(Date.now() / 1000) + Math.floor(days * 24 * 60 * 60);

export const createTweetActivityId = () => `act_${randomUUID()}`;

const toStringArray = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }
  if (typeof value === "string") {
    const cleaned = value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }
  return undefined;
};

const normalizeMedia = (value: unknown): TweetActivityMedia[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const media = value
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const entry = item as Record<string, unknown>;
      const key = String(entry.key ?? "").trim();
      if (!key) return undefined;
      const kind = entry.kind === "video" ? "video" : "image";
      return {
        contentType: entry.contentType ? String(entry.contentType) : undefined,
        fileName: entry.fileName ? String(entry.fileName) : undefined,
        key,
        kind,
        sizeBytes:
          typeof entry.sizeBytes === "number" ? entry.sizeBytes : undefined,
      } as TweetActivityMedia;
    })
    .filter(Boolean) as TweetActivityMedia[];
  return media.length ? media : undefined;
};

/** Build a full activity record from an untrusted request body. */
export const buildTweetActivity = (
  body: Record<string, unknown>
): TweetActivity => {
  const context = String(body.context ?? "").trim();
  if (!context) throw new Error("context is required.");

  const now = new Date().toISOString();
  return {
    entity: "activity",
    appId: body.appId ? String(body.appId).trim() : undefined,
    context,
    createdAt: now,
    expiresAt: ttlSecondsFromNow(),
    id: createTweetActivityId(),
    links: toStringArray(body.links),
    media: normalizeMedia(body.media),
    status: "pending",
    tags: toStringArray(body.tags),
    title: body.title ? String(body.title).trim() : undefined,
    toolsUsed: toStringArray(body.toolsUsed),
    updatedAt: now,
  };
};
