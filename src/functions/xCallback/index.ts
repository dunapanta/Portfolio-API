import { APIGatewayProxyEvent } from "aws-lambda";
import { dynamo } from "@libs/dynamo";
import {
  getSocialConnectionsTableName,
  parseCookies,
  serializeCookie,
} from "@libs/facebookOAuth";
import { exchangeXCode, xConnectionId } from "@libs/xOAuth";

const redirectAfterOAuth = (
  status: "connected" | "error",
  returnTo?: string,
  message?: string
) => {
  const target =
    returnTo === "tweet-studio"
      ? process.env.TWEET_STUDIO_URL || "https://www.dunapant.dev/tweet-studio"
      : process.env.SWIPE2PLAY_REEL_MAKER_URL ||
        "https://www.dunapant.dev/10000-offline-games/reel-maker";
  const url = new URL(target);

  url.searchParams.set("x", status);
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
        "Location": redirectAfterOAuth("error", cookies.s2p_x_return_to, error),
      },
      body: "",
    };
  }

  if (
    !code ||
    !state ||
    state !== cookies.s2p_x_oauth_state ||
    !cookies.s2p_x_code_verifier
  ) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Invalid X OAuth callback state." }),
    };
  }

  try {
    const token = await exchangeXCode({
      code,
      codeVerifier: cookies.s2p_x_code_verifier,
    });
    const now = new Date().toISOString();

    await dynamo.write(
      {
        id: xConnectionId,
        accessToken: token.access_token,
        accessTokenExpiresAt: token.expires_in
          ? Math.floor(Date.now() / 1000) + token.expires_in
          : undefined,
        connectedAt: now,
        platform: "x",
        refreshToken: token.refresh_token,
        scope: token.scope,
        updatedAt: now,
      },
      getSocialConnectionsTableName()
    );

    const clearStateCookie = serializeCookie({
      maxAge: 0,
      name: "s2p_x_oauth_state",
      value: "",
    });
    const clearVerifierCookie = serializeCookie({
      maxAge: 0,
      name: "s2p_x_code_verifier",
      value: "",
    });
    const clearReturnToCookie = serializeCookie({
      maxAge: 0,
      name: "s2p_x_return_to",
      value: "",
    });

    return {
      statusCode: 302,
      cookies: [clearStateCookie, clearVerifierCookie, clearReturnToCookie],
      headers: {
        "Location": redirectAfterOAuth("connected", cookies.s2p_x_return_to),
      },
      body: "",
    };
  } catch (callbackError) {
    return {
      statusCode: 302,
      headers: {
        "Location": redirectAfterOAuth(
          "error",
          cookies.s2p_x_return_to,
          callbackError instanceof Error ? callbackError.message : "X OAuth failed."
        ),
      },
      body: "",
    };
  }
};
