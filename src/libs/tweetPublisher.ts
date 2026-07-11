import { dynamo } from "@libs/dynamo";
import {
  composeTweetText,
  getScheduledTweetsTableName,
  ScheduledTweet,
} from "@libs/scheduledTweets";
import { getTweetMediaObject, inferTweetMediaKind } from "@libs/tweetMedia";
import { getValidXAccessToken, postTweet, uploadMediaToX } from "@libs/xApi";

/**
 * Publishes a single queued tweet to X: uploads its media, posts the main
 * tweet, chains any thread parts, and persists the resulting status. Shared by
 * the manual publish endpoint and the cron worker so behavior stays identical.
 */
export const publishTweetRecord = async (
  tweet: ScheduledTweet
): Promise<ScheduledTweet> => {
  const table = getScheduledTweetsTableName();
  const startedAt = new Date().toISOString();

  await dynamo.update({
    id: tweet.id,
    tableName: table,
    data: {
      status: "publishing",
      attemptCount: (tweet.attemptCount ?? 0) + 1,
      error: undefined,
      updatedAt: startedAt,
    },
  });

  try {
    const accessToken = await getValidXAccessToken();

    // Upload media (max 4 images, or a single video). Videos can't mix.
    const mediaIds: string[] = [];
    const media = tweet.media ?? [];
    const hasVideo = media.some(
      (item) =>
        item.kind === "video" ||
        (item.contentType && item.contentType.startsWith("video/"))
    );
    const usable = hasVideo ? media.slice(0, 1) : media.slice(0, 4);

    for (const item of usable) {
      const object = await getTweetMediaObject(item.key);
      const kind = inferTweetMediaKind(item.contentType || object.contentType);
      const mediaId = await uploadMediaToX({
        accessToken,
        buffer: object.buffer,
        contentType: item.contentType || object.contentType,
        kind,
      });
      mediaIds.push(mediaId);
    }

    // Main tweet.
    const main = await postTweet({
      accessToken,
      mediaIds: mediaIds.length ? mediaIds : undefined,
      text: composeTweetText(tweet.text, tweet.hashtags),
    });

    // Thread replies (text only).
    let replyToId = main.id;
    for (const part of tweet.threadParts ?? []) {
      const reply = await postTweet({
        accessToken,
        inReplyToTweetId: replyToId,
        text: part.slice(0, 280),
      });
      replyToId = reply.id;
    }

    const postedAt = new Date().toISOString();
    const updated = (await dynamo.update({
      id: tweet.id,
      tableName: table,
      data: {
        status: "posted",
        postedAt,
        tweetUrl: main.url,
        xTweetId: main.id,
        error: undefined,
        updatedAt: postedAt,
      },
    })) as ScheduledTweet;

    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown publish error.";
    const updated = (await dynamo.update({
      id: tweet.id,
      tableName: table,
      data: {
        status: "failed",
        error: message,
        updatedAt: new Date().toISOString(),
      },
    })) as ScheduledTweet;
    // Re-throw for the manual endpoint; the cron catches per-tweet.
    (updated as ScheduledTweet & { publishError?: string }).publishError = message;
    return updated;
  }
};
