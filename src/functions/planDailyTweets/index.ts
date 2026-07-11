import { dynamo } from "@libs/dynamo";
import {
  buildScheduledTweet,
  getScheduledTweetsTableName,
  listRecentTweets,
} from "@libs/scheduledTweets";
import {
  getTweetActivityTableName,
  TweetActivity,
} from "@libs/tweetActivity";
import { generateTweetDrafts } from "@libs/tweetGenerator";

/** Minutes the timezone is ahead of UTC (negative for the Americas). */
const getTzOffsetMinutes = (timezone: string) => {
  const now = new Date();
  const tz = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((tz.getTime() - utc.getTime()) / 60000);
};

/** Unix seconds for today's HH:MM in the given timezone. */
const slotEpochToday = (hhmm: string, timezone: string) => {
  const [hh, mm] = hhmm.split(":").map((n) => Number(n));
  const offsetMinutes = getTzOffsetMinutes(timezone);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = ymd.split("-").map((n) => Number(n));
  const utcMillis =
    Date.UTC(year, month - 1, day, hh || 0, mm || 0) - offsetMinutes * 60000;
  return Math.floor(utcMillis / 1000);
};

const startOfTodayEpoch = (timezone: string) => slotEpochToday("00:00", timezone);

export const handler = async () => {
  const timezone = process.env.TWEET_STUDIO_TIMEZONE || "America/Guayaquil";
  const target = Math.max(Number(process.env.TWEET_STUDIO_DAILY_TARGET || 2), 0);
  const slots = (process.env.TWEET_STUDIO_SLOTS || "13:00,20:00")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!target) {
    console.log("[planDailyTweets] daily target is 0, skipping.");
    return { scheduled: 0 };
  }

  // How many tweets already cover today (scheduled or posted)?
  const dayStart = startOfTodayEpoch(timezone);
  const recent = await listRecentTweets(200);
  const todaysCount = recent.filter(
    (t) =>
      ["scheduled", "posted", "publishing"].includes(t.status) &&
      t.scheduledAt >= dayStart
  ).length;

  const remaining = Math.max(target - todaysCount, 0);
  if (!remaining) {
    console.log(`[planDailyTweets] already have ${todaysCount} for today.`);
    return { scheduled: 0 };
  }

  // Pull pending activity context to write from (oldest first).
  const { items } = await dynamo.queryPage({
    tableName: getTweetActivityTableName(),
    index: "GSI-activity-recent",
    pkKey: "entity",
    pkValue: "activity",
    limit: 50,
    sortAscending: true,
  });
  const pending = (items as TweetActivity[]).filter(
    (a) => a.status === "pending"
  );

  if (!pending.length) {
    console.log("[planDailyTweets] no pending activity to schedule.");
    return { scheduled: 0 };
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  let scheduled = 0;

  for (let i = 0; i < remaining && i < pending.length; i += 1) {
    const activity = pending[i];
    // Pick a slot for today; if it already passed, push 5 min out.
    const slot = slots[(todaysCount + i) % Math.max(slots.length, 1)] || "20:00";
    let scheduledAt = slotEpochToday(slot, timezone);
    if (scheduledAt <= nowEpoch) scheduledAt = nowEpoch + 300 + i * 60;

    try {
      const { drafts } = await generateTweetDrafts({
        context: {
          appId: activity.appId,
          context: activity.context,
          links: activity.links,
          tags: activity.tags,
          title: activity.title,
          toolsUsed: activity.toolsUsed,
          hasMedia: Boolean(activity.media?.length),
        },
        count: 1,
      });
      const draft = drafts[0];
      if (!draft) continue;

      const tweet = buildScheduledTweet({
        appId: activity.appId,
        format: draft.format,
        hashtags: draft.hashtags,
        media: activity.media,
        scheduledAt,
        sourceActivityId: activity.id,
        status: "scheduled",
        text: draft.text,
        threadParts: draft.threadParts,
      });

      await dynamo.write(tweet, getScheduledTweetsTableName());
      await dynamo.update({
        id: activity.id,
        tableName: getTweetActivityTableName(),
        data: { status: "used", updatedAt: new Date().toISOString() },
      });
      scheduled += 1;
      console.log(`[planDailyTweets] scheduled ${tweet.id} at ${scheduledAt}`);
    } catch (error) {
      console.error(
        `[planDailyTweets] failed for activity ${activity.id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return { scheduled };
};
