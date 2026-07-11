import { dynamo } from "@libs/dynamo";
import { getSocialConnectionsTableName } from "@libs/facebookOAuth";
import { refreshXAccessToken, xConnectionId } from "@libs/xOAuth";
import { TweetMediaKind } from "@libs/tweetMedia";

const X_API = "https://api.x.com/2";
const MEDIA_UPLOAD_URL = `${X_API}/media/upload`;
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB per APPEND

type XConnection = {
  accessToken?: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  scope?: string;
};

/**
 * Returns a valid X access token, refreshing (and persisting the rotated
 * refresh token) when the stored one is expired or about to expire.
 */
export const getValidXAccessToken = async (): Promise<string> => {
  const table = getSocialConnectionsTableName();
  const connection = (await dynamo.get(xConnectionId, table)) as
    | XConnection
    | undefined;

  if (!connection?.refreshToken) {
    throw new Error("X account is not connected. Connect X in Tweet Studio first.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const stillValid =
    connection.accessToken &&
    connection.accessTokenExpiresAt &&
    connection.accessTokenExpiresAt - 60 > nowSeconds;

  if (stillValid) return connection.accessToken as string;

  const refreshed = await refreshXAccessToken(connection.refreshToken);
  const now = new Date().toISOString();

  await dynamo.update({
    id: xConnectionId,
    tableName: table,
    data: {
      accessToken: refreshed.access_token,
      accessTokenExpiresAt: refreshed.expires_in
        ? nowSeconds + refreshed.expires_in
        : undefined,
      // X rotates refresh tokens; keep the newest, fall back to the old one.
      refreshToken: refreshed.refresh_token || connection.refreshToken,
      scope: refreshed.scope || connection.scope,
      updatedAt: now,
    },
  });

  if (!refreshed.access_token) throw new Error("X did not return an access token.");
  return refreshed.access_token;
};

const authHeader = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
});

const mediaCategoryFor = (kind: TweetMediaKind, contentType: string) => {
  if (kind === "video") return "tweet_video";
  if (contentType.toLowerCase().includes("gif")) return "tweet_gif";
  return "tweet_image";
};

const postForm = async (
  accessToken: string,
  form: FormData,
  context: string
) => {
  const response = await fetch(MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: authHeader(accessToken),
    body: form,
  });
  const data = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    const message =
      data?.errors?.[0]?.message ||
      data?.error ||
      data?.detail ||
      `X media ${context} failed (${response.status}).`;
    throw new Error(message);
  }
  return data;
};

const readMediaId = (data: any): string => {
  const id = data?.data?.id || data?.media_id_string || data?.media_id;
  if (!id) throw new Error("X did not return a media id.");
  return String(id);
};

const readProcessingInfo = (data: any) =>
  data?.data?.processing_info || data?.processing_info;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForMediaProcessing = async (accessToken: string, mediaId: string) => {
  // Poll STATUS until video/gif finishes transcoding (max ~2 minutes).
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const url = `${MEDIA_UPLOAD_URL}?command=STATUS&media_id=${encodeURIComponent(
      mediaId
    )}`;
    const response = await fetch(url, { headers: authHeader(accessToken) });
    const data = (await response.json().catch(() => ({}))) as any;
    const info = readProcessingInfo(data);

    if (!info || info.state === "succeeded") return;
    if (info.state === "failed") {
      throw new Error(
        info?.error?.message || "X failed to process the uploaded media."
      );
    }
    await sleep(Math.min((info.check_after_secs || 3) * 1000, 8000));
  }
  throw new Error("Timed out waiting for X to process the media.");
};

/**
 * Chunked (INIT/APPEND/FINALIZE) upload via the v2 media endpoint. Works with
 * OAuth2 user tokens that include the media.write scope. Returns the media id.
 */
export const uploadMediaToX = async ({
  accessToken,
  buffer,
  contentType,
  kind,
}: {
  accessToken: string;
  buffer: Buffer;
  contentType: string;
  kind: TweetMediaKind;
}): Promise<string> => {
  const category = mediaCategoryFor(kind, contentType);

  // INIT
  const initForm = new FormData();
  initForm.set("command", "INIT");
  initForm.set("total_bytes", String(buffer.length));
  initForm.set("media_type", contentType);
  initForm.set("media_category", category);
  const initData = await postForm(accessToken, initForm, "INIT");
  const mediaId = readMediaId(initData);

  // APPEND (chunked)
  let segmentIndex = 0;
  for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
    const chunk = buffer.subarray(offset, offset + CHUNK_SIZE);
    const appendForm = new FormData();
    appendForm.set("command", "APPEND");
    appendForm.set("media_id", mediaId);
    appendForm.set("segment_index", String(segmentIndex));
    appendForm.set(
      "media",
      new Blob([chunk], { type: "application/octet-stream" }),
      "chunk"
    );
    await postForm(accessToken, appendForm, `APPEND #${segmentIndex}`);
    segmentIndex += 1;
  }

  // FINALIZE
  const finalizeForm = new FormData();
  finalizeForm.set("command", "FINALIZE");
  finalizeForm.set("media_id", mediaId);
  const finalizeData = await postForm(accessToken, finalizeForm, "FINALIZE");

  // Videos/gifs may need async processing before they can be attached.
  if (readProcessingInfo(finalizeData)) {
    await waitForMediaProcessing(accessToken, mediaId);
  }

  return mediaId;
};

export type PostTweetResult = {
  id: string;
  url: string;
};

/** Post a single tweet, optionally with media and/or as a reply (threads). */
export const postTweet = async ({
  accessToken,
  inReplyToTweetId,
  mediaIds,
  text,
}: {
  accessToken: string;
  inReplyToTweetId?: string;
  mediaIds?: string[];
  text: string;
}): Promise<PostTweetResult> => {
  const body: Record<string, unknown> = { text };
  if (mediaIds?.length) body.media = { media_ids: mediaIds };
  if (inReplyToTweetId) body.reply = { in_reply_to_tweet_id: inReplyToTweetId };

  const response = await fetch(`${X_API}/tweets`, {
    method: "POST",
    headers: {
      ...authHeader(accessToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as any;

  if (!response.ok) {
    const message =
      data?.errors?.[0]?.message ||
      data?.detail ||
      data?.title ||
      `X tweet failed (${response.status}).`;
    throw new Error(message);
  }

  const id = data?.data?.id;
  if (!id) throw new Error("X did not return a tweet id.");
  return { id: String(id), url: `https://x.com/i/status/${id}` };
};
