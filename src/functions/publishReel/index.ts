import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  facebookConnectionId,
  getMetaConfig,
  getSocialConnectionsTableName,
} from "@libs/facebookOAuth";
import { createDownloadUrl, getReelJobsTableName } from "@libs/reelJobs";

type PublishPlatform = "facebook" | "instagram";

type ReelAsset = {
  contentType?: string;
  fileName?: string;
  key?: string;
  kind?: string;
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

const waitForInstagramContainer = async ({
  accessToken,
  containerId,
  graphBaseUrl,
}: {
  accessToken: string;
  containerId: string;
  graphBaseUrl: string;
}) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const statusUrl = new URL(`${graphBaseUrl}/${containerId}`);
    statusUrl.searchParams.set("fields", "status_code");
    statusUrl.searchParams.set("access_token", accessToken);

    const response = await fetch(statusUrl);
    if (!response.ok) {
      throw new Error(`Instagram status check failed: ${await readTextResponse(response)}`);
    }

    const data = (await response.json()) as { status_code?: string };
    if (data.status_code === "FINISHED" || data.status_code === "PUBLISHED") return data;
    if (data.status_code === "ERROR" || data.status_code === "EXPIRED") {
      throw new Error(`Instagram container is ${data.status_code}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  throw new Error("Instagram video is still processing. Try again in a minute.");
};

const publishInstagramReel = async ({
  caption,
  connection,
  videoUrl,
}: {
  caption: string;
  connection: Record<string, any>;
  videoUrl: string;
}) => {
  const { graphBaseUrl } = getMetaConfig();
  const igUserId = connection.instagramBusinessAccountId;
  const accessToken = connection.userAccessToken;

  if (!igUserId || !accessToken) {
    throw new Error("Missing Instagram account or user token in Dynamo.");
  }

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

  await waitForInstagramContainer({
    accessToken,
    containerId: created.id,
    graphBaseUrl,
  });

  const publishBody = new URLSearchParams({
    access_token: accessToken,
    creation_id: created.id,
  });

  const publishResponse = await fetch(`${graphBaseUrl}/${igUserId}/media_publish`, {
    method: "POST",
    body: publishBody,
  });

  if (!publishResponse.ok) {
    throw new Error(`Instagram publish failed: ${await readTextResponse(publishResponse)}`);
  }

  const published = await publishResponse.json();
  return {
    containerId: created.id,
    id: (published as { id?: string }).id,
    platform: "instagram",
    raw: published,
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

  return {
    id,
    platform: "facebook",
    raw: published,
    url: id ? `https://www.facebook.com/${id}` : undefined,
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

    if (platform !== "facebook" && platform !== "instagram") {
      return formatJSONResponse({
        statusCode: 400,
        data: { message: "platform must be facebook or instagram." },
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

    const connection = await dynamo.get(facebookConnectionId, getSocialConnectionsTableName());
    if (!connection) {
      return formatJSONResponse({
        statusCode: 401,
        data: { message: "Connect Facebook before publishing." },
      });
    }

    const videoUrl = await createDownloadUrl(asset.key);
    const result =
      platform === "instagram"
        ? await publishInstagramReel({
            caption: String(body.caption || ""),
            connection,
            videoUrl,
          })
        : await publishFacebookVideo({
            connection,
            description: String(body.description || ""),
            title: String(body.title || "Swipe2Play"),
            videoUrl,
          });

    const publishResults = {
      ...(typeof reel.publishResults === "object" ? reel.publishResults : {}),
      [platform]: {
        ...result,
        publishedAt: new Date().toISOString(),
      },
    };

    const updatedReel = await dynamo.update({
      id: reelId,
      tableName: getReelJobsTableName(),
      data: {
        publishResults,
        status: "published",
        updatedAt: new Date().toISOString(),
      },
    });

    return formatJSONResponse({
      data: {
        message: `${platform} publish completed.`,
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
