import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  facebookConnectionId,
  getMetaConfig,
  getSocialConnectionsTableName,
} from "@libs/facebookOAuth";
import { createDownloadUrl, getReelJobsTableName } from "@libs/reelJobs";
import {
  refreshYouTubeAccessToken,
  youtubeConnectionId,
} from "@libs/youtubeOAuth";

type PublishPlatform = "facebook" | "instagram" | "youtube";

type ReelAsset = {
  bucket?: string;
  contentType?: string;
  fileName?: string;
  key?: string;
  kind?: string;
};

type InstagramContainerStatus = {
  status_code?: string;
};

type InstagramPublishResult = {
  containerId?: string;
  id?: string;
  message?: string;
  platform: "instagram";
  raw?: unknown;
  status?: "processing" | "published";
  statusCode?: string;
  url?: string;
};

const readTextResponse = async (response: Response) => {
  const text = await response.text();
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
};

const selectPublishAsset = (assets: ReelAsset[]) => {
  const preferredKinds = ["rendered-reel", "rendered-video", "manual-video"];
  return (
    assets.find((asset) => asset.key && preferredKinds.includes(asset.kind || "")) ||
    assets.find((asset) => asset.key && asset.contentType?.startsWith("video/"))
  );
};

const getInstagramContainerStatus = async ({
  accessToken,
  containerId,
  graphBaseUrl,
}: {
  accessToken: string;
  containerId: string;
  graphBaseUrl: string;
}) => {
  const statusUrl = new URL(`${graphBaseUrl}/${containerId}`);
  statusUrl.searchParams.set("fields", "status_code");
  statusUrl.searchParams.set("access_token", accessToken);

  const response = await fetch(statusUrl);
  if (!response.ok) {
    throw new Error(`Instagram status check failed: ${await readTextResponse(response)}`);
  }

  return (await response.json()) as InstagramContainerStatus;
};

const waitForInstagramContainer = async ({
  accessToken,
  containerId,
  graphBaseUrl,
}: {
  accessToken: string;
  containerId: string;
  graphBaseUrl: string;
}) => {
  let latestStatus: InstagramContainerStatus = {};

  for (let attempt = 0; attempt < 5; attempt += 1) {
    latestStatus = await getInstagramContainerStatus({
      accessToken,
      containerId,
      graphBaseUrl,
    });

    if (
      latestStatus.status_code === "FINISHED" ||
      latestStatus.status_code === "PUBLISHED"
    ) {
      return latestStatus;
    }

    if (latestStatus.status_code === "ERROR" || latestStatus.status_code === "EXPIRED") {
      throw new Error(`Instagram container is ${latestStatus.status_code}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  return latestStatus;
};

const publishInstagramReel = async ({
  caption,
  connection,
  existingResult,
  videoUrl,
}: {
  caption: string;
  connection: Record<string, any>;
  existingResult?: InstagramPublishResult;
  videoUrl: string;
}): Promise<InstagramPublishResult> => {
  const { graphBaseUrl } = getMetaConfig();
  const igUserId = connection.instagramBusinessAccountId;
  const accessToken = connection.userAccessToken;

  if (!igUserId || !accessToken) {
    throw new Error("Missing Instagram account or user token in Dynamo.");
  }

  if (existingResult?.status === "published" && existingResult.id) {
    return existingResult;
  }

  let containerId = existingResult?.status === "processing" ? existingResult.containerId : undefined;

  if (!containerId) {
    const createBody = new URLSearchParams({
      access_token: accessToken,
      caption,
      media_type: "REELS",
      video_url: videoUrl,
    });

    const createResponse = await fetch(`${graphBaseUrl}/${igUserId}/media`, {
      method: "POST",
      body: createBody,
    });

    if (!createResponse.ok) {
      throw new Error(
        `Instagram container creation failed: ${await readTextResponse(createResponse)}`
      );
    }

    const created = (await createResponse.json()) as { id?: string };
    if (!created.id) throw new Error("Instagram did not return a media container id.");
    containerId = created.id;
  }

  const status = await waitForInstagramContainer({
    accessToken,
    containerId,
    graphBaseUrl,
  });

  if (status.status_code !== "FINISHED" && status.status_code !== "PUBLISHED") {
    return {
      containerId,
      message: "Instagram video is still processing. Try again in a minute.",
      platform: "instagram",
      status: "processing",
      statusCode: status.status_code || "IN_PROGRESS",
    };
  }

  const publishBody = new URLSearchParams({
    access_token: accessToken,
    creation_id: containerId,
  });

  const publishResponse = await fetch(`${graphBaseUrl}/${igUserId}/media_publish`, {
    method: "POST",
    body: publishBody,
  });

  if (!publishResponse.ok) {
    throw new Error(`Instagram publish failed: ${await readTextResponse(publishResponse)}`);
  }

  const published = await publishResponse.json();
  const id = (published as { id?: string }).id;
  let url: string | undefined;

  if (id) {
    const permalinkUrl = new URL(`${graphBaseUrl}/${id}`);
    permalinkUrl.searchParams.set("fields", "permalink");
    permalinkUrl.searchParams.set("access_token", accessToken);

    const permalinkResponse = await fetch(permalinkUrl);
    if (permalinkResponse.ok) {
      const permalinkData = (await permalinkResponse.json()) as { permalink?: string };
      url = permalinkData.permalink;
    }
  }

  return {
    containerId,
    id,
    status: "published",
    platform: "instagram",
    raw: published,
    url,
  };
};

const publishFacebookVideo = async ({
  connection,
  description,
  title,
  videoUrl,
}: {
  connection: Record<string, any>;
  description: string;
  title: string;
  videoUrl: string;
}) => {
  const { graphBaseUrl } = getMetaConfig();
  const pageId = connection.pageId;
  const accessToken = connection.pageAccessToken;

  if (!pageId || !accessToken) {
    throw new Error("Missing Facebook Page token in Dynamo.");
  }

  const body = new URLSearchParams({
    access_token: accessToken,
    description,
    file_url: videoUrl,
    title,
  });

  const response = await fetch(`${graphBaseUrl}/${pageId}/videos`, {
    method: "POST",
    body,
  });

  if (!response.ok) {
    throw new Error(`Facebook video publish failed: ${await readTextResponse(response)}`);
  }

  const published = await response.json();
  const id = (published as { id?: string }).id;
  let url = id ? `https://www.facebook.com/reel/${id}/` : undefined;

  if (id) {
    const permalinkUrl = new URL(`${graphBaseUrl}/${id}`);
    permalinkUrl.searchParams.set("fields", "permalink_url");
    permalinkUrl.searchParams.set("access_token", accessToken);

    const permalinkResponse = await fetch(permalinkUrl);
    if (permalinkResponse.ok) {
      const permalinkData = (await permalinkResponse.json()) as { permalink_url?: string };
      if (permalinkData.permalink_url) {
        url = permalinkData.permalink_url.startsWith("http")
          ? permalinkData.permalink_url
          : `https://www.facebook.com${permalinkData.permalink_url}`;
      }
    }
  }

  return {
    id,
    platform: "facebook",
    raw: published,
    url,
  };
};

const splitTags = (value = "") =>
  value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const publishYouTubeShort = async ({
  asset,
  connection,
  metadata,
  videoUrl,
}: {
  asset: ReelAsset;
  connection: Record<string, any>;
  metadata: Record<string, any>;
  videoUrl: string;
}) => {
  const refreshToken = connection.refreshToken;
  if (!refreshToken) throw new Error("Missing YouTube refresh token in Dynamo.");

  const videoResponse = await fetch(videoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Unable to download reel from S3: ${await readTextResponse(videoResponse)}`);
  }

  const buffer = Buffer.from(await videoResponse.arrayBuffer());
  const accessToken = await refreshYouTubeAccessToken(refreshToken);
  const title = String(metadata.title || "Swipe2Play #Shorts").trim();
  const description = String(metadata.description || "").trim();
  const privacyStatus = String(metadata.privacyStatus || "unlisted");
  const categoryId = String(metadata.categoryId || "20");
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags
    : splitTags(String(metadata.tags || "Swipe2Play,shorts,mobile game"));

  const initResponse = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(buffer.length),
        "X-Upload-Content-Type": asset.contentType || "video/mp4",
      },
      body: JSON.stringify({
        snippet: {
          categoryId,
          description,
          tags,
          title,
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      }),
    }
  );

  if (!initResponse.ok) {
    throw new Error(`YouTube upload session failed: ${await readTextResponse(initResponse)}`);
  }

  const uploadUrl = initResponse.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not return an upload URL.");

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Length": String(buffer.length),
      "Content-Type": asset.contentType || "video/mp4",
    },
    body: buffer,
  });

  if (!uploadResponse.ok) {
    throw new Error(`YouTube upload failed: ${await readTextResponse(uploadResponse)}`);
  }

  const published = await uploadResponse.json();
  const id = (published as { id?: string }).id;

  return {
    id,
    platform: "youtube",
    raw: published,
    shortsUrl: id ? `https://youtube.com/shorts/${id}` : undefined,
    url: id ? `https://www.youtube.com/watch?v=${id}` : undefined,
  };
};

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const reelId = event.pathParameters?.reelId;
    const body = event.body ? JSON.parse(event.body) : {};
    const platform = body.platform as PublishPlatform | undefined;

    if (!reelId) {
      return formatJSONResponse({
        statusCode: 400,
        data: { message: "Missing reelId path parameter." },
      });
    }

    if (platform !== "facebook" && platform !== "instagram" && platform !== "youtube") {
      return formatJSONResponse({
        statusCode: 400,
        data: { message: "platform must be facebook, instagram, or youtube." },
      });
    }

    const reel = await dynamo.get(reelId, getReelJobsTableName());
    if (!reel) {
      return formatJSONResponse({
        statusCode: 404,
        data: { message: "Reel job not found." },
      });
    }

    const assets = Array.isArray(reel.assets) ? (reel.assets as ReelAsset[]) : [];
    const asset = selectPublishAsset(assets);
    if (!asset?.key) {
      return formatJSONResponse({
        statusCode: 400,
        data: { message: "Reel does not have a video asset in S3." },
      });
    }

    const connection = await dynamo.get(
      platform === "youtube" ? youtubeConnectionId : facebookConnectionId,
      getSocialConnectionsTableName()
    );
    if (!connection) {
      return formatJSONResponse({
        statusCode: 401,
        data: { message: `Connect ${platform} before publishing.` },
      });
    }

    const videoUrl = await createDownloadUrl(asset.key, asset.bucket);
    const publishResults =
      typeof reel.publishResults === "object" ? reel.publishResults : {};
    const existingPlatformResult = publishResults[platform];
    const result =
      platform === "instagram"
        ? await publishInstagramReel({
            caption: String(body.caption || ""),
            connection,
            existingResult: existingPlatformResult as InstagramPublishResult | undefined,
            videoUrl,
          })
        : platform === "facebook"
        ? await publishFacebookVideo({
            connection,
            description: String(body.description || ""),
            title: String(body.title || "Swipe2Play"),
            videoUrl,
          })
        : await publishYouTubeShort({
            asset,
            connection,
            metadata: body,
            videoUrl,
          });

    const resultStatus = (result as InstagramPublishResult).status;
    const isInstagramProcessing = resultStatus === "processing";
    const nextPublishResults = {
      ...publishResults,
      [platform]: {
        ...result,
        ...(isInstagramProcessing
          ? { updatedAt: new Date().toISOString() }
          : { publishedAt: new Date().toISOString() }),
      },
    };

    const updatedReel = await dynamo.update({
      id: reelId,
      tableName: getReelJobsTableName(),
      data: {
        publishResults: nextPublishResults,
        status: isInstagramProcessing ? "publishing" : "published",
        updatedAt: new Date().toISOString(),
      },
    });

    return formatJSONResponse({
      statusCode: isInstagramProcessing ? 202 : 200,
      data: {
        message: isInstagramProcessing
          ? (result as InstagramPublishResult).message
          : `${platform} publish completed.`,
        reel: updatedReel,
        result,
      },
    });
  } catch (error) {
    console.log(error);
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: error instanceof Error ? error.message : "Unable to publish reel.",
      },
    });
  }
};
