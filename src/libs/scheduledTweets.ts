import { randomUUID } from "crypto";
import { dynamo } from "@libs/dynamo";
import { ttlSecondsFromNow } from "@libs/tweetActivity";

/**
 * A tweet (or thread) queued for a specific time. The cron worker queries
 * GSI-tweets-by-status for status = "scheduled" and scheduledAt <= now.
 */
export type ScheduledTweetStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "posted"
  | "failed"
  | "canceled";

export type ScheduledTweetMedia = {
  contentType?: string;
  fileName?: string;
  key: string;
  kind?: "image" | "video";
  sizeBytes?: number;
};

export type ScheduledTweet = {
  entity: "tweet";
  appId?: string;
  attemptCount?: number;
  createdAt: string;
  error?: string;
  expiresAt: number;
  format?: string;
  hashtags?: string[];
  id: string;
  media?: ScheduledTweetMedia[];
  postedAt?: string;
  // Extra tweets appended as a thread reply chain (text only for now).
  threadParts?: string[];
  scheduledAt: number; // unix seconds
  sourceActivityId?: string;
  status: ScheduledTweetStatus;
  text: string;
  tweetUrl?: string;
  updatedAt: string;
  xTweetId?: string;
};

export const getScheduledTweetsTableName = () => {
  const tableName = process.env.scheduledTweetsTable;
  if (!tableName) throw new Error("Missing scheduledTweetsTable env var.");
  return tableName;
};

export const createScheduledTweetId = () => `twt_${randomUUID()}`;

const TWEET_LIMIT = 280;

const toStringArray = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    const cleaned = value.map((v) => String(v ?? "").trim()).filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }
  if (typeof value === "string") {
    const cleaned = value
      .split(/[\n,]/)
      .map((v) => v.trim())
      .filter(Boolean);
    return cleaned.length ? cleaned : undefined;
  }
  return undefined;
};

const normalizeHashtags = (value: unknown): string[] | undefined => {
  const tags = toStringArray(value);
  if (!tags) return undefined;
  const normalized = tags.map((tag) =>
    tag.startsWith("#") ? tag : `#${tag.replace(/^#+/, "")}`
  );
  return normalized.length ? normalized : undefined;
};

const normalizeMedia = (value: unknown): ScheduledTweetMedia[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const media = value
    .map((item) => {
      if (!item || typeof item !== "object") return undefined;
      const entry = item as Record<string, unknown>;
      const key = String(entry.key ?? "").trim();
      if (!key) return undefined;
      return {
        contentType: entry.contentType ? String(entry.contentType) : undefined,
        fileName: entry.fileName ? String(entry.fileName) : undefined,
        key,
        kind: entry.kind === "video" ? "video" : "image",
        sizeBytes:
          typeof entry.sizeBytes === "number" ? entry.sizeBytes : undefined,
      } as ScheduledTweetMedia;
    })
    .filter(Boolean) as ScheduledTweetMedia[];
  // X allows up to 4 images OR a single video/gif.
  return media.length ? media.slice(0, 4) : undefined;
};

const normalizeScheduledAt = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Accept both seconds and milliseconds.
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  // Default: 10 minutes from now.
  return Math.floor(Date.now() / 1000) + 600;
};

/** Compose the final tweet text: body + hashtags, trimmed to 280 chars. */
export const composeTweetText = (
  text: string,
  hashtags?: string[]
): string => {
  const body = String(text ?? "").trim();
  if (!hashtags?.length) return body.slice(0, TWEET_LIMIT);

  const tagLine = hashtags.join(" ");
  const combined = `${body}\n\n${tagLine}`;
  if (combined.length <= TWEET_LIMIT) return combined;

  // Drop hashtags one by one until it fits, else hard-truncate the body.
  const tags = [...hashtags];
  while (tags.length) {
    tags.pop();
    const candidate = tags.length ? `${body}\n\n${tags.join(" ")}` : body;
    if (candidate.length <= TWEET_LIMIT) return candidate;
  }
  return body.slice(0, TWEET_LIMIT);
};

export const buildScheduledTweet = (
  body: Record<string, unknown>
): ScheduledTweet => {
  const text = String(body.text ?? "").trim();
  if (!text) throw new Error("text is required.");

  const now = new Date().toISOString();
  const statusInput = String(body.status ?? "scheduled");
  const status: ScheduledTweetStatus =
    statusInput === "draft" ? "draft" : "scheduled";

  return {
    entity: "tweet",
    appId: body.appId ? String(body.appId).trim() : undefined,
    attemptCount: 0,
    createdAt: now,
    expiresAt: ttlSecondsFromNow(),
    format: body.format ? String(body.format).trim() : undefined,
    hashtags: normalizeHashtags(body.hashtags),
    id: createScheduledTweetId(),
    media: normalizeMedia(body.media),
    scheduledAt: normalizeScheduledAt(body.scheduledAt),
    sourceActivityId: body.sourceActivityId
      ? String(body.sourceActivityId)
      : undefined,
    status,
    text,
    threadParts: toStringArray(body.threadParts),
    updatedAt: now,
  };
};

/** Sanitize a PATCH body into a whitelist of updatable fields. */
export const buildScheduledTweetPatch = (
  body: Record<string, unknown>
): Record<string, unknown> => {
  const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (body.text !== undefined) {
    const text = String(body.text).trim();
    if (!text) throw new Error("text cannot be empty.");
    patch.text = text;
  }
  if (body.hashtags !== undefined) patch.hashtags = normalizeHashtags(body.hashtags);
  if (body.media !== undefined) patch.media = normalizeMedia(body.media);
  if (body.threadParts !== undefined)
    patch.threadParts = toStringArray(body.threadParts);
  if (body.scheduledAt !== undefined)
    patch.scheduledAt = normalizeScheduledAt(body.scheduledAt);
  if (body.appId !== undefined) patch.appId = String(body.appId).trim();
  if (body.format !== undefined) patch.format = String(body.format).trim();
  if (body.status !== undefined) {
    const allowed: ScheduledTweetStatus[] = [
      "draft",
      "scheduled",
      "canceled",
    ];
    const next = String(body.status) as ScheduledTweetStatus;
    if (!allowed.includes(next)) {
      throw new Error("status can only be set to draft, scheduled, or canceled.");
    }
    patch.status = next;
  }

  return patch;
};

/** Find tweets whose scheduledAt has passed and are still waiting. */
export const findDueTweets = async (limitEpoch = Math.floor(Date.now() / 1000)) => {
  const items = (await dynamo.query({
    tableName: getScheduledTweetsTableName(),
    index: "GSI-tweets-by-status",
    pkKey: "status",
    pkValue: "scheduled",
    skKey: "scheduledAt",
    sortAscending: true,
  })) as ScheduledTweet[] | undefined;

  return (items ?? []).filter((tweet) => tweet.scheduledAt <= limitEpoch);
};

export const listRecentTweets = async (limit = 50) => {
  const { items } = await dynamo.queryPage({
    tableName: getScheduledTweetsTableName(),
    index: "GSI-tweets-recent",
    pkKey: "entity",
    pkValue: "tweet",
    limit,
    sortAscending: false,
  });
  return (items ?? []) as ScheduledTweet[];
};
