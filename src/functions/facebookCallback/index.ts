import { APIGatewayProxyEvent } from "aws-lambda";
import { dynamo } from "@libs/dynamo";
import {
  exchangeCodeForShortToken,
  exchangeShortTokenForLongToken,
  facebookConnectionId,
  getFacebookAccounts,
  getFacebookUser,
  getSocialConnectionsTableName,
  getTokenExpiry,
  parseCookies,
  selectFacebookAccount,
  serializeCookie,
} from "@libs/facebookOAuth";

const redirectToReelMaker = (status: "connected" | "error", message?: string) => {
  const url = new URL(
    process.env.SWIPE2PLAY_REEL_MAKER_URL ||
      "https://www.dunapant.dev/10000-offline-games/reel-maker"
  );

  url.searchParams.set("facebook", status);
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

  if (!code || !state || state !== cookies.s2p_fb_oauth_state) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Invalid Facebook OAuth callback state.",
      }),
    };
  }

  try {
    const shortToken = await exchangeCodeForShortToken(code);
    const longToken = await exchangeShortTokenForLongToken(shortToken);
    const user = await getFacebookUser(longToken.accessToken);
    const accounts = await getFacebookAccounts(longToken.accessToken);
    const account = selectFacebookAccount(accounts);

    if (!account?.access_token) {
      throw new Error("No Facebook Page token was returned for this user.");
    }

    const now = new Date().toISOString();
    const connection = {
      id: facebookConnectionId,
      connectedAt: now,
      expiresAt: getTokenExpiry(longToken.expiresIn),
      facebookUserId: user.id,
      facebookUserName: user.name,
      instagramBusinessAccountId: account.instagram_business_account?.id,
      pageAccessToken: account.access_token,
      pageId: account.id,
      pageName: account.name,
      platform: "facebook",
      updatedAt: now,
      userAccessToken: longToken.accessToken,
    };

    await dynamo.write(connection, getSocialConnectionsTableName());
    const clearStateCookie = serializeCookie({
      maxAge: 0,
      name: "s2p_fb_oauth_state",
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
          callbackError instanceof Error ? callbackError.message : "Facebook OAuth failed."
        ),
      },
      body: "",
    };
  }
};
