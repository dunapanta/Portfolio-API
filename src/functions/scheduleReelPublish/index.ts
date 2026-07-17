import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { getGameContextsTableName } from "@libs/gameContexts";
import { getReelJobsTableName } from "@libs/reelJobs";
import { generateReelPlatformCaptions, ReelPlatformCaptions } from "@libs/reelCaptions";
import { PublishPlatform, selectPublishAsset } from "@libs/reelPublishing";

const allowedPlatforms: PublishPlatform[] = ["facebook", "instagram", "youtube", "x"];

const normalizeScheduledAt = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  throw new Error("scheduledAt must be an ISO date or unix epoch.");
};

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const reelId = event.pathParameters?.reelId;
    if (!reelId) throw new Error("Missing reelId path parameter.");

    const body = event.body ? JSON.parse(event.body) : {};
    const table = getReelJobsTableName();
    const reel = await dynamo.get(reelId, table);
    if (!reel) {
      return formatJSONResponse({
        statusCode: 404,
        data: { message: "Reel job not found." },
      });
    }

    if (body.cancel) {
      const restored = (reel.publishSchedule as { previousStatus?: string })
        ?.previousStatus;
      const updated = await dynamo.update({
        id: reelId,
        tableName: table,
        data: {
          publishSchedule: undefined,
          status: restored || "rendered",
          updatedAt: new Date().toISOString(),
        },
      });
      return formatJSONResponse({
        data: { message: "Publish schedule canceled.", reel: updated },
      });
    }

    const asset = selectPublishAsset(Array.isArray(reel.assets) ? reel.assets : []);
    if (!asset?.key) {
      throw new Error("Reel has no rendered video yet - render it before scheduling.");
    }

    const scheduledAt = normalizeScheduledAt(body.scheduledAt);
    const platforms = (
      Array.isArray(body.platforms) && body.platforms.length
        ? body.platforms
        : ["facebook", "instagram", "youtube"]
    ).filter((p: string): p is PublishPlatform =>
      allowedPlatforms.includes(p as PublishPlatform)
    );
    if (!platforms.length) throw new Error("No valid platforms provided.");

    // Captions: caller-provided, or generated from the game context.
    let captions = body.captions as ReelPlatformCaptions | undefined;
    let captionsModel: string | undefined;
    if (!captions) {
      const game = reel.gameId
        ? await dynamo.get(String(reel.gameId), getGameContextsTableName())
        : undefined;
      const generated = await generateReelPlatformCaptions({
        game: game || { title: "Swipe2Play" },
        reelSummary: reel.render?.phrase
          ? `Reel voiceover: ${reel.render.phrase}`
          : reel.title,
      });
      captions = generated.captions;
      captionsModel = generated.model;
    }

    const now = new Date().toISOString();
    const updated = await dynamo.update({
      id: reelId,
      tableName: table,
      data: {
        publishSchedule: {
          attemptCount: 0,
          captions,
          captionsModel,
          createdAt: now,
          platforms,
          previousStatus: reel.status,
          scheduledAt,
        },
        status: "publish-scheduled",
        updatedAt: now,
      },
    });

    return formatJSONResponse({
      statusCode: 201,
      data: {
        message: `Reel scheduled for ${new Date(scheduledAt * 1000).toISOString()} on ${platforms.join(", ")}.`,
        reel: updated,
      },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: {
        message: error instanceof Error ? error.message : "Unable to schedule reel.",
      },
    });
  }
};
