import { APIGatewayProxyEvent } from "aws-lambda";
import { dynamo } from "@libs/dynamo";
import {
  getSocialConnectionsTableName,
  parseCookies,
  serializeCookie,
} from "@libs/facebookOAuth";
import { exchangeYouTubeCode, youtubeConnectionId } from "@libs/youtubeOAuth";

const redirectToReelMaker = (status: "connected" | "error", message?: string) => {
  const url = new URL(
    process.env.SWIPE2PLAY_REEL_MAKER_URL ||
      "https://www.dunapant.dev/10000-offline-games/reel-maker"
  );

  url.searchParams.set("youtube", status);
  if (message) url.searchParams.set("message", message);

  return url.toString();
};

const getCookieHeader = (event: APIGatewayProxyEvent) => {
  const eventWithCookies = event as APIGatewayProxyEvent & { cookies?: string[] };
  return (
    event.headers.cookie ||
    event.headers.Cookie ||
    eventWithCookies.cookies?.join("; ") ||
    ""
  );
};

export const handler = async (event: APIGatewayProxyEvent) => {
  const query = event.queryStringParameters ?? {};
  const code = query.code;
  const state = query.state;
  const error = query.error_description || query.error;
  const cookies = parseCookies(getCookieHeader(event));

  if (error) {
    return {
      statusCode: 302,
      headers: {
        "Location": redirectToReelMaker("error", error),
      },
      body: "",
    };
  }

  if (!code || !state || state !== cookies.s2p_youtube_oauth_state) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Invalid YouTube OAuth callback state.",
      }),
    };
  }

  try {
    const token = await exchangeYouTubeCode(code);
    const now = new Date().toISOString();

    await dynamo.write(
      {
        id: youtubeConnectionId,
        accessToken: token.access_token,
        accessTokenExpiresAt: token.expires_in
          ? Math.floor(Date.now() / 1000) + token.expires_in
          : undefined,
        connectedAt: now,
        platform: "youtube",
        refreshToken: token.refresh_token,
        updatedAt: now,
      },
      getSocialConnectionsTableName()
    );

    const clearStateCookie = serializeCookie({
      maxAge: 0,
      name: "s2p_youtube_oauth_state",
      value: "",
    });

    return {
      statusCode: 302,
      cookies: [clearStateCookie],
      headers: {
        "Location": redirectToReelMaker("connected"),
      },
      body: "",
    };
  } catch (callbackError) {
    return {
      statusCode: 302,
      headers: {
        "Location": redirectToReelMaker(
          "error",
          callbackError instanceof Error ? callbackError.message : "YouTube OAuth failed."
        ),
      },
      body: "",
    };
  }
};
