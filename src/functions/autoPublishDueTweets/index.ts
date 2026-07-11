import { findDueTweets, ScheduledTweet } from "@libs/scheduledTweets";
import { publishTweetRecord } from "@libs/tweetPublisher";

/**
 * Cron worker (runs every ~10 min). Finds tweets whose scheduled time has
 * passed and publishes them one by one. Failures are isolated per-tweet so one
 * bad tweet never blocks the rest of the queue.
 */
export const handler = async () => {
  const due = await findDueTweets();
  if (!due.length) {
    console.log("[autoPublishDueTweets] nothing due.");
    return { published: 0, failed: 0 };
  }

  console.log(`[autoPublishDueTweets] ${due.length} tweet(s) due.`);
  let published = 0;
  let failed = 0;

  for (const tweet of due as ScheduledTweet[]) {
    try {
      const result = await publishTweetRecord(tweet);
      const publishError = (result as ScheduledTweet & { publishError?: string })
        .publishError;
      if (publishError) {
        failed += 1;
        console.error(`[autoPublishDueTweets] ${tweet.id} failed: ${publishError}`);
      } else {
        published += 1;
        console.log(`[autoPublishDueTweets] ${tweet.id} posted: ${result.tweetUrl}`);
      }
    } catch (error) {
      failed += 1;
      console.error(
        `[autoPublishDueTweets] ${tweet.id} threw:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return { published, failed };
};
