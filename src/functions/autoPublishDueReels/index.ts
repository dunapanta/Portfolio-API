import { dynamo } from "@libs/dynamo";
import { getReelJobsTableName } from "@libs/reelJobs";
import {
  InstagramPublishResult,
  PublishPlatform,
  publishReelToPlatform,
} from "@libs/reelPublishing";
import { ReelPlatformCaptions } from "@libs/reelCaptions";

const maxAttempts = 6;

type ScheduledReel = Record<string, any> & {
  id: string;
  publishSchedule?: {
    attemptCount?: number;
    captions?: ReelPlatformCaptions;
    errors?: Partial<Record<PublishPlatform, string>>;
    platforms?: PublishPlatform[];
    scheduledAt?: number;
  };
};

const metadataFor = (
  platform: PublishPlatform,
  captions: ReelPlatformCaptions | undefined
): Record<string, any> => {
  if (!captions) return {};
  if (platform === "instagram") return { caption: captions.instagram?.caption || "" };
  if (platform === "facebook") {
    return {
      description: captions.facebook?.description || "",
      title: captions.facebook?.title || "Swipe2Play",
    };
  }
  if (platform === "youtube") {
    return {
      description: captions.youtube?.description || "",
      privacyStatus: captions.youtube?.privacyStatus || "public",
      tags: captions.youtube?.tags || [],
      title: captions.youtube?.title || "Swipe2Play #Shorts",
    };
  }
  return { text: captions.instagram?.caption || "" };
};

/**
 * Cron (every 10 min): publishes reels whose scheduled time has passed to all
 * their target platforms. Instagram's async container flow is resumed across
 * runs; per-platform failures are isolated and retried up to maxAttempts.
 */
export const handler = async () => {
  const table = getReelJobsTableName();
  const nowEpoch = Math.floor(Date.now() / 1000);

  const scheduled = ((await dynamo.query({
    tableName: table,
    index: "GSI-reel-jobs-by-status",
    pkKey: "status",
    pkValue: "publish-scheduled",
    sortAscending: true,
  })) ?? []) as ScheduledReel[];

  const due = scheduled.filter(
    (reel) => (reel.publishSchedule?.scheduledAt ?? Infinity) <= nowEpoch
  );

  if (!due.length) {
    console.log("[autoPublishDueReels] nothing due.");
    return { processed: 0 };
  }

  let processed = 0;

  for (const reel of due) {
    const schedule = reel.publishSchedule ?? {};
    const platforms = schedule.platforms ?? [];
    const captions = schedule.captions;
    const publishResults: Record<string, any> =
      typeof reel.publishResults === "object" && reel.publishResults
        ? { ...reel.publishResults }
        : {};
    const errors: Partial<Record<PublishPlatform, string>> = {};
    let hasProcessing = false;

    for (const platform of platforms) {
      const existing = publishResults[platform];
      if (existing?.publishedAt || existing?.status === "published") continue;

      try {
        const result = await publishReelToPlatform({
          metadata: metadataFor(platform, captions),
          platform,
          reel: { ...reel, publishResults },
        });
        const isProcessing =
          (result as InstagramPublishResult).status === "processing";
        hasProcessing = hasProcessing || isProcessing;
        publishResults[platform] = {
          ...result,
          ...(isProcessing
            ? { updatedAt: new Date().toISOString() }
            : { publishedAt: new Date().toISOString() }),
        };
        console.log(
          `[autoPublishDueReels] ${reel.id} -> ${platform}: ${
            isProcessing ? "processing" : "published"
          }`
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "publish failed";
        errors[platform] = message;
        console.error(`[autoPublishDueReels] ${reel.id} -> ${platform}: ${message}`);
      }
    }

    const pendingPlatforms = platforms.filter(
      (platform) =>
        !publishResults[platform]?.publishedAt &&
        publishResults[platform]?.status !== "published"
    );
    const attemptCount = (schedule.attemptCount ?? 0) + 1;
    const exhausted = attemptCount >= maxAttempts && pendingPlatforms.length > 0;
    const done = pendingPlatforms.length === 0;

    await dynamo.update({
      id: reel.id,
      tableName: table,
      data: {
        publishResults,
        publishSchedule: done
          ? undefined
          : {
              ...schedule,
              attemptCount,
              errors: Object.keys(errors).length ? errors : schedule.errors,
              hasProcessing,
            },
        status: done
          ? "published"
          : exhausted
          ? "publish-failed"
          : "publish-scheduled",
        updatedAt: new Date().toISOString(),
      },
    });

    processed += 1;
  }

  return { processed };
};
