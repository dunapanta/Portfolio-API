import * as crypto from "crypto";

export type FacebookAccount = {
  access_token?: string;
  id: string;
  instagram_business_account?: {
    id: string;
  };
  name: string;
};

type FacebookTokenResponse = {
  access_token?: string;
  error?: {
    message?: string;
  };
  expires_in?: number;
  token_type?: string;
};

type FacebookMeResponse = {
  id?: string;
  name?: string;
};

type FacebookAccountsResponse = {
  data?: FacebookAccount[];
};

export const facebookConnectionId = "swipe2play-facebook";

export const getSocialConnectionsTableName = () => {
  const tableName = process.env.socialConnectionsTable;
  if (!tableName) throw new Error("socialConnectionsTable env var is not configured.");
  return tableName;
};

export const getMetaConfig = () => {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const graphVersion = process.env.META_GRAPH_VERSION || "v25.0";
  const redirectUri = process.env.META_OAUTH_REDIRECT_URI;

  if (!appId || !redirectUri) {
    throw new Error("Missing META_APP_ID or META_OAUTH_REDIRECT_URI.");
  }

  return {
    appId,
    appSecret,
    graphBaseUrl: `https://graph.facebook.com/${graphVersion}`,
    graphVersion,
    redirectUri,
  };
};

export const createFacebookState = () => crypto.randomBytes(24).toString("hex");

export const parseCookies = (cookieHeader = "") =>
  cookieHeader.split(";").reduce<Record<string, string>>((cookies, cookie) => {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (!rawName) return cookies;
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
    return cookies;
  }, {});

export const serializeCookie = ({
  maxAge,
  name,
  value,
}: {
  maxAge: number;
  name: string;
  value: string;
}) =>
  [
    `${name}=${encodeURIComponent(value)}`,
    "HttpOnly",
    `Max-Age=${maxAge}`,
    "Path=/",
    "SameSite=Lax",
    "Secure",
  ].join("; ");

export const getFacebookLoginUrl = (state: string) => {
  const { appId, graphVersion, redirectUri } = getMetaConfig();
  const url = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);

  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set(
    "scope",
    [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_posts",
      "read_insights",
      "instagram_basic",
      "instagram_content_publish",
      "instagram_manage_insights",
    ].join(",")
  );

  return url.toString();
};

const getJson = async <Data>(url: string): Promise<Data> => {
  const response = await fetch(url);
  const data = (await response.json()) as Data;

  if (!response.ok) {
    const message =
      (data as FacebookTokenResponse).error?.message || `Meta request failed: ${response.status}`;
    throw new Error(message);
  }

  return data;
};

export const exchangeCodeForShortToken = async (code: string) => {
  const { appId, appSecret, graphBaseUrl, redirectUri } = getMetaConfig();
  if (!appSecret) throw new Error("Missing META_APP_SECRET.");
  const url = new URL(`${graphBaseUrl}/oauth/access_token`);

  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("code", code);
  url.searchParams.set("redirect_uri", redirectUri);

  const data = await getJson<FacebookTokenResponse>(url.toString());
  if (!data.access_token) throw new Error("Meta did not return an access token.");

  return data.access_token;
};

export const exchangeShortTokenForLongToken = async (shortToken: string) => {
  const { appId, appSecret, graphBaseUrl } = getMetaConfig();
  if (!appSecret) throw new Error("Missing META_APP_SECRET.");
  const url = new URL(`${graphBaseUrl}/oauth/access_token`);

  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);
  url.searchParams.set("grant_type", "fb_exchange_token");

  const data = await getJson<FacebookTokenResponse>(url.toString());
  if (!data.access_token) throw new Error("Meta did not return a long-lived access token.");

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
};

export const getFacebookUser = async (accessToken: string) => {
  const { graphBaseUrl } = getMetaConfig();
  const url = new URL(`${graphBaseUrl}/me`);

  url.searchParams.set("fields", "id,name");
  url.searchParams.set("access_token", accessToken);

  const data = await getJson<FacebookMeResponse>(url.toString());
  if (!data.id) throw new Error("Meta did not return a Facebook user.");

  return data;
};

export const getFacebookAccounts = async (accessToken: string) => {
  const { graphBaseUrl } = getMetaConfig();
  const url = new URL(`${graphBaseUrl}/me/accounts`);

  url.searchParams.set("fields", "id,name,access_token,instagram_business_account");
  url.searchParams.set("access_token", accessToken);

  const data = await getJson<FacebookAccountsResponse>(url.toString());
  return data.data ?? [];
};

export const selectFacebookAccount = (accounts: FacebookAccount[]) => {
  const preferredPageId = process.env.META_PAGE_ID;
  const preferred = preferredPageId
    ? accounts.find((account) => account.id === preferredPageId)
    : undefined;

  return preferred ?? accounts.find((account) => account.instagram_business_account) ?? accounts[0];
};

export const getTokenExpiry = (expiresIn?: number) => {
  const fallbackSeconds = 60 * 24 * 60 * 60;
  return Math.floor(Date.now() / 1000) + (expiresIn ?? fallbackSeconds);
};
