import * as crypto from "crypto";

export const youtubeConnectionId = "swipe2play-youtube";
export const youtubeUploadScope = "https://www.googleapis.com/auth/youtube.upload";
export const youtubeReadonlyScope = "https://www.googleapis.com/auth/youtube.readonly";

type GoogleTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
  refresh_token?: string;
};

export const getYouTubeConfig = () => {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_OAUTH_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, or YOUTUBE_OAUTH_REDIRECT_URI."
    );
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
  };
};

export const createYouTubeState = () => crypto.randomBytes(24).toString("hex");

export const getYouTubeLoginUrl = (state: string) => {
  const { clientId, redirectUri } = getYouTubeConfig();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [youtubeUploadScope, youtubeReadonlyScope].join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  return url.toString();
};

export const exchangeYouTubeCode = async (code: string) => {
  const { clientId, clientSecret, redirectUri } = getYouTubeConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const data = (await response.json()) as GoogleTokenResponse;
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Google OAuth token exchange failed.");
  }

  if (!data.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke app access and connect YouTube again."
    );
  }

  return data;
};

export const refreshYouTubeAccessToken = async (refreshToken: string) => {
  const { clientId, clientSecret } = getYouTubeConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = (await response.json()) as GoogleTokenResponse;
  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Unable to refresh YouTube token.");
  }

  if (!data.access_token) throw new Error("Google did not return an access token.");
  return data.access_token;
};
