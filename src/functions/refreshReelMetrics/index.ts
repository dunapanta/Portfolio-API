import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  facebookConnectionId,
  getMetaConfig,
  getSocialConnectionsTableName,
} from "@libs/facebookOAuth";
import { getReelJobsTableName } from "@libs/reelJobs";
import {
  refreshYouTubeAccessToken,
  youtubeConnectionId,
} from "@libs/youtubeOAuth";

type PlatformMetrics = {
  comments?: number;
  impressions?: number;
  likes?: number;
  plays?: number;
  reach?: number;
  saved?: number;
  shares?: number;
  updatedAt: string;
  views?: number;
};

const numberOrUndefined = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const readTextResponse = async (response: Response) => {
  const text = await response.text();
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

const fetchFacebookMetrics = async ({
  pageAccessToken,
  videoId,
}: {
  pageAccessToken: string;
  videoId: string;
}): Promise<PlatformMetrics> => {
  const { graphBaseUrl } = getMetaConfig();
  const url = new URL(`${graphBaseUrl}/${videoId}/video_insights`);
  url.searchParams.set("metric", "total_video_views,total_video_impressions");
  url.searchParams.set("access_token", pageAccessToken);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Facebook metrics failed: ${await readTextResponse(response)}`);
  }

  const data = (await response.json()) as {
    data?: Array<{
      name?: string;
      values?: Array<{ value?: unknown }>;
    }>;
  };
  const metricValue = (name: string) =>
    numberOrUndefined(data.data?.find((metric) => metric.name === name)?.values?.[0]?.value);

  return {
    impressions: metricValue("total_video_impressions"),
    updatedAt: new Date().toISOString(),
    views: metricValue("total_video_views"),
  };
};

const fetchInstagramMetrics = async ({
  mediaId,
  userAccessToken,
}: {
  mediaId: string;
  userAccessToken: string;
}): Promise<PlatformMetrics> => {
  const { graphBaseUrl } = getMetaConfig();
  const url = new URL(`${graphBaseUrl}/${mediaId}/insights`);
  url.searchParams.set("metric", "plays,reach,total_interactions,likes,comments,shares,saved");
  url.searchParams.set("access_token", userAccessToken);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Instagram metrics failed: ${await readTextResponse(response)}`);
  }

  const data = (await response.json()) as {
    data?: Array<{
      name?: string;
      values?: Array<{ value?: unknown }>;
    }>;
  };
  const metricValue = (name: string) =>
    numberOrUndefined(data.data?.find((metric) => metric.name === name)?.values?.[0]?.value);

  return {
    comments: metricValue("comments"),
    likes: metricValue("likes"),
    plays: metricValue("plays"),
    reach: metricValue("reach"),
    saved: metricValue("saved"),
    shares: metricValue("shares"),
    updatedAt: new Date().toISOString(),
    views: metricValue("plays"),
  };
};

const fetchYouTubeMetrics = async ({
  refreshToken,
  videoId,
}: {
  refreshToken: string;
  videoId: string;
}): Promise<PlatformMetrics> => {
  const accessToken = await refreshYouTubeAccessToken(refreshToken);
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "statistics");
  url.searchParams.set("id", videoId);

  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new Error(`YouTube metrics failed: ${await readTextResponse(response)}`);
  }

  const data = (await response.json()) as {
    items?: Array<{
      statistics?: {
        commentCount?: string;
        likeCount?: string;
        viewCount?: string;
      };
    }>;
  };
  const statistics = data.items?.[0]?.statistics ?? {};

  return {
    comments: numberOrUndefined(statistics.commentCount),
    likes: numberOrUndefined(statistics.likeCount),
    updatedAt: new Date().toISOString(),
    views: numberOrUndefined(statistics.viewCount),
  };
};

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const reelId = event.pathParameters?.reelId;
    if (!reelId) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Missing reelId path parameter.",
        },
      });
    }

    const reel = await dynamo.get(reelId, getReelJobsTableName());
    if (!reel) {
      return formatJSONResponse({
        statusCode: 404,
        data: {
          message: "Reel job not found.",
        },
      });
    }

    const publishResults = reel.publishResults ?? {};
    const metricsResults = reel.metricsResults ?? {};
    const errors: Record<string, string> = {};
    const nextMetrics = { ...metricsResults };

    if (publishResults.youtube?.id) {
      try {
        const connection = await dynamo.get(youtubeConnectionId, getSocialConnectionsTableName());
        if (!connection?.refreshToken) throw new Error("Missing YouTube refresh token.");
        nextMetrics.youtube = await fetchYouTubeMetrics({
          refreshToken: connection.refreshToken,
          videoId: publishResults.youtube.id,
        });
      } catch (error) {
        errors.youtube = error instanceof Error ? error.message : "Unable to fetch YouTube metrics.";
      }
    }

    if (publishResults.instagram?.id) {
      try {
        const connection = await dynamo.get(facebookConnectionId, getSocialConnectionsTableName());
        if (!connection?.userAccessToken) throw new Error("Missing Meta user token.");
        nextMetrics.instagram = await fetchInstagramMetrics({
          mediaId: publishResults.instagram.id,
          userAccessToken: connection.userAccessToken,
        });
      } catch (error) {
        errors.instagram =
          error instanceof Error ? error.message : "Unable to fetch Instagram metrics.";
      }
    }

    if (publishResults.facebook?.id) {
      try {
        const connection = await dynamo.get(facebookConnectionId, getSocialConnectionsTableName());
        if (!connection?.pageAccessToken) throw new Error("Missing Facebook Page token.");
        nextMetrics.facebook = await fetchFacebookMetrics({
          pageAccessToken: connection.pageAccessToken,
          videoId: publishResults.facebook.id,
        });
      } catch (error) {
        errors.facebook =
          error instanceof Error ? error.message : "Unable to fetch Facebook metrics.";
      }
    }

    const updatedReel = await dynamo.update({
      id: reelId,
      tableName: getReelJobsTableName(),
      data: {
        metricsErrors: errors,
        metricsResults: nextMetrics,
        metricsUpdatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

    return formatJSONResponse({
      statusCode: Object.keys(errors).length ? 207 : 200,
      data: {
        errors,
        message: Object.keys(errors).length
          ? "Some platform metrics could not be refreshed."
          : "Metrics refreshed successfully.",
        reel: updatedReel,
      },
    });
  } catch (err) {
    console.log(err);
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: err.message,
      },
    });
  }
};
