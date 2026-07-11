import * as crypto from "crypto";

export const xConnectionId = "swipe2play-x";

const xScopes = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "media.write",
  "offline.access",
];

type XTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

export const getXConfig = () => {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirectUri = process.env.X_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing X_CLIENT_ID, X_CLIENT_SECRET, or X_OAUTH_REDIRECT_URI.");
  }

  return { clientId, clientSecret, redirectUri };
};

export const createXState = () => crypto.randomBytes(24).toString("hex");

export const createXCodeVerifier = () => crypto.randomBytes(32).toString("hex");

const getBasicAuthHeader = (clientId: string, clientSecret: string) =>
  `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;

export const getXLoginUrl = ({
  codeVerifier,
  state,
}: {
  codeVerifier: string;
  state: string;
}) => {
  const { clientId, redirectUri } = getXConfig();
  const url = new URL("https://x.com/i/oauth2/authorize");

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", xScopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeVerifier);
  url.searchParams.set("code_challenge_method", "plain");

  return url.toString();
};

export const exchangeXCode = async ({
  code,
  codeVerifier,
}: {
  code: string;
  codeVerifier: string;
}) => {
  const { clientId, clientSecret, redirectUri } = getXConfig();
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: getBasicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const data = (await response.json()) as XTokenResponse;
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "X OAuth token exchange failed.");
  }

  if (!data.access_token) throw new Error("X did not return an access token.");
  if (!data.refresh_token) {
    throw new Error("X did not return a refresh token. Confirm offline.access is enabled.");
  }

  return data;
};

export const refreshXAccessToken = async (refreshToken: string) => {
  const { clientId, clientSecret } = getXConfig();
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: getBasicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = (await response.json()) as XTokenResponse;
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Unable to refresh X token.");
  }

  if (!data.access_token) throw new Error("X did not return an access token.");
  return data;
};
