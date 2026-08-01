#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const ASTRO_MCP_URL = process.env.ASTRO_MCP_URL || "http://127.0.0.1:8089/mcp";
const API_URL = (process.env.APP_OPPORTUNITIES_API_URL || "").replace(/\/$/, "");
const ACCESS_KEY = process.env.APP_OPPORTUNITIES_ACCESS_KEY || "";
const RSS_LIMIT = Math.min(100, Math.max(10, Number(process.env.APP_OPPORTUNITIES_RSS_LIMIT || 50)));
const APPS_PER_COUNTRY = Math.min(16, Math.max(3, Number(process.env.APP_OPPORTUNITIES_APPS_PER_COUNTRY || 7)));
const RESULTS_PER_COUNTRY = Math.min(50, Math.max(5, Number(process.env.APP_OPPORTUNITIES_RESULTS_PER_COUNTRY || 24)));
const COUNTRIES_PER_RUN = Math.min(30, Math.max(1, Number(process.env.APP_OPPORTUNITIES_COUNTRIES_PER_RUN || 12)));
const MCP_CONCURRENCY = Math.min(8, Math.max(1, Number(process.env.APP_OPPORTUNITIES_MCP_CONCURRENCY || 4)));
const MCP_INTERVAL_MS = Math.max(2_050, Number(process.env.APP_OPPORTUNITIES_MCP_INTERVAL_MS || 2_200));

const DEFAULT_COUNTRIES = [
  "us", "ca", "mx", "br", "ar", "cl", "co", "pe", "ec", "cr",
  "gb", "ie", "es", "pt", "fr", "de", "it", "nl", "be", "ch",
  "at", "se", "no", "dk", "fi", "pl", "cz", "ro", "gr", "tr",
  "au", "nz", "jp", "kr", "in", "id", "sg", "my", "th", "vn",
  "ph", "hk", "tw", "ae", "sa", "il", "za", "ng", "eg", "ke",
];

const FEEDS = [
  "newfreeapplications",
  "topgrossingapplications",
  "toppaidapplications",
];

const FEED_WEIGHT = {
  newfreeapplications: 4,
  topgrossingapplications: 8,
  toppaidapplications: 6,
};

const MEGA_PUBLISHER_PATTERN = /openai|google|meta platforms|instagram|tiktok|bytedance|microsoft|amazon|netflix|disney|spotify|snap,? inc|apple inc|telegram|whatsapp/i;
const NOISE_KEYWORDS = new Set([
  "app", "apps", "free", "gratis", "gratuit", "online", "download", "update",
  "at", "the", "for", "and", "pro", "plus", "best", "new", "mobile",
]);

const argValue = (name) => {
  const direct = process.argv.find((value) => value.startsWith(`${name}=`));
  return direct ? direct.slice(name.length + 1) : undefined;
};

const noUpload = process.argv.includes("--no-upload");
const requestedCountries = argValue("--countries") || process.env.APP_OPPORTUNITIES_COUNTRIES;

const parseCountries = (value) => value
  .split(",")
  .map((country) => country.trim().toLowerCase())
  .filter((country) => /^[a-z]{2,3}$/.test(country));

const rotatingCountries = () => {
  if (requestedCountries) return Array.from(new Set(parseCountries(requestedCountries)));
  const day = Math.floor(Date.now() / 86_400_000);
  const start = (day * COUNTRIES_PER_RUN) % DEFAULT_COUNTRIES.length;
  return Array.from({ length: COUNTRIES_PER_RUN }, (_, index) =>
    DEFAULT_COUNTRIES[(start + index) % DEFAULT_COUNTRIES.length]
  );
};

const readContentText = (result) => {
  const text = (result?.content || [])
    .filter((item) => item?.type === "text")
    .map((item) => item.text || "")
    .join("")
    .trim();
  if (result?.isError) throw new Error(text || "Astro MCP tool call failed.");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

class AstroMcpClient {
  constructor(url) {
    this.url = url;
    this.sessionId = "";
    this.id = 1;
    this.nextToolCallAt = 0;
    this.rateQueue = Promise.resolve();
  }

  async post(message, includeSession = true) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...(includeSession && this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new Error(`Astro MCP returned HTTP ${response.status}.`);
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    const raw = await response.text();
    if (!raw) return undefined;
    const payload = response.headers.get("content-type")?.includes("text/event-stream")
      ? raw.split(/\r?\n/).filter((line) => line.startsWith("data:"))
          .map((line) => JSON.parse(line.slice(5).trim())).pop()
      : JSON.parse(raw);
    if (payload?.error) throw new Error(payload.error.message || "Astro MCP request failed.");
    return payload?.result;
  }

  async initialize() {
    await this.post({
      jsonrpc: "2.0",
      id: this.id++,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "duportfolio-opportunity-radar", version: "1.0.0" },
      },
    }, false);
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async call(name, args) {
    const previous = this.rateQueue;
    let release;
    this.rateQueue = new Promise((resolve) => { release = resolve; });
    await previous;
    const wait = Math.max(0, this.nextToolCallAt - Date.now());
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    this.nextToolCallAt = Date.now() + MCP_INTERVAL_MS;
    release();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const result = await this.post({
          jsonrpc: "2.0",
          id: this.id++,
          method: "tools/call",
          params: { name, arguments: args },
        });
        return readContentText(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= 2 || !/rate limit|temporarily busy|wait/i.test(message)) throw error;
        const retryDelay = 32_000 + attempt * 10_000;
        console.warn(`[astro] rate limited; retrying in ${Math.round(retryDelay / 1000)}s`);
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
    return undefined;
  }
}

const pool = async (items, concurrency, worker) => {
  const output = new Array(items.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
};

const rssValue = (entry, key) => entry?.[key]?.label || "";

const readRss = async (store, chart) => {
  const url = `https://itunes.apple.com/${store}/rss/${chart}/limit=${RSS_LIMIT}/json`;
  try {
    const response = await fetch(url, { headers: { "User-Agent": "DuPortfolio-OpportunityRadar/1.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return (Array.isArray(data?.feed?.entry) ? data.feed.entry : []).map((entry, index) => ({
      appId: String(entry?.id?.attributes?.["im:id"] || "").trim(),
      appName: rssValue(entry, "im:name").trim(),
      artist: rssValue(entry, "im:artist").trim(),
      category: String(entry?.category?.attributes?.label || "").trim(),
      chart,
      chartRank: index + 1,
      releaseDate: rssValue(entry, "im:releaseDate") || undefined,
      store,
    })).filter((entry) => entry.appId && entry.appName);
  } catch (error) {
    console.warn(`[rss] ${store}/${chart}: ${error instanceof Error ? error.message : error}`);
    return [];
  }
};

const selectDiverseApps = (entries) => {
  const usefulEntries = entries.filter((entry) => !MEGA_PUBLISHER_PATTERN.test(entry.artist));
  const byFeed = new Map(FEEDS.map((feed) => [feed, usefulEntries.filter((entry) => entry.chart === feed)]));
  const selected = [];
  const usedApps = new Set();
  const categoryCount = new Map();
  const publisherCount = new Map();
  let round = 0;
  while (selected.length < APPS_PER_COUNTRY && round < RSS_LIMIT) {
    for (const feed of FEEDS) {
      const candidate = byFeed.get(feed)?.[round];
      if (!candidate || usedApps.has(candidate.appId)) continue;
      const categoryKey = candidate.category || "Other";
      const publisherKey = candidate.artist || candidate.appName;
      if ((categoryCount.get(categoryKey) || 0) >= 2) continue;
      if ((publisherCount.get(publisherKey) || 0) >= 1) continue;
      selected.push(candidate);
      usedApps.add(candidate.appId);
      categoryCount.set(categoryKey, (categoryCount.get(categoryKey) || 0) + 1);
      publisherCount.set(publisherKey, (publisherCount.get(publisherKey) || 0) + 1);
      if (selected.length >= APPS_PER_COUNTRY) break;
    }
    round += 1;
  }
  if (selected.length < APPS_PER_COUNTRY) {
    for (const candidate of usefulEntries) {
      if (usedApps.has(candidate.appId)) continue;
      selected.push(candidate);
      usedApps.add(candidate.appId);
      if (selected.length >= APPS_PER_COUNTRY) break;
    }
  }
  return selected;
};

const normalizeKeyword = (value) => String(value || "")
  .normalize("NFKC")
  .trim()
  .toLocaleLowerCase()
  .replace(/\s+/g, " ");

const rawScore = (opportunity) => {
  const demand = ((opportunity.popularity - 20) / 40) * 44;
  const competition = ((100 - opportunity.difficulty) / 100) * 46;
  const chart = Math.max(...opportunity.sourceApps.map((source) => FEED_WEIGHT[source.chart] || 0), 0);
  return Math.round(demand + competition + chart);
};

const selectDiverseOpportunities = (items) => {
  const sorted = [...items].filter((item) => {
    const keyword = normalizeKeyword(item.keyword);
    return keyword.length >= 3 && !NOISE_KEYWORDS.has(keyword);
  }).sort((a, b) => rawScore(b) - rawScore(a));
  const selected = [];
  const sourceCount = new Map();
  const categoryCount = new Map();
  for (const item of sorted) {
    const primary = item.sourceApps[0];
    const sourceKey = primary?.appId || item.keyword;
    const categoryKey = primary?.category || "Other";
    if ((sourceCount.get(sourceKey) || 0) >= 3) continue;
    if ((categoryCount.get(categoryKey) || 0) >= 6) continue;
    selected.push(item);
    sourceCount.set(sourceKey, (sourceCount.get(sourceKey) || 0) + 1);
    categoryCount.set(categoryKey, (categoryCount.get(categoryKey) || 0) + 1);
    if (selected.length >= RESULTS_PER_COUNTRY) break;
  }
  return selected;
};

const suggestionsForApp = async (client, app) => {
  try {
    const suggestions = await client.call("get_keyword_suggestions", {
      appId: app.appId,
      store: app.store,
      highPopularity: false,
    });
    return (Array.isArray(suggestions) ? suggestions : [])
      .map((suggestion) => ({
        appsCount: Number.isFinite(Number(suggestion?.appsCount)) ? Math.round(Number(suggestion.appsCount)) : undefined,
        difficulty: Math.round(Number(suggestion?.difficulty)),
        keyword: String(suggestion?.text || "").trim(),
        popularity: Math.round(Number(suggestion?.popularity)),
        sourceApps: [{
          appId: app.appId,
          appName: app.appName,
          category: app.category || undefined,
          chart: app.chart,
          chartRank: app.chartRank,
          releaseDate: app.releaseDate,
        }],
        store: app.store,
      }))
      .filter((item) =>
        item.keyword.length >= 2 &&
        Number.isFinite(item.popularity) && item.popularity > 20 && item.popularity <= 60 &&
        Number.isFinite(item.difficulty) && item.difficulty >= 0 && item.difficulty <= 100
      );
  } catch (error) {
    console.warn(`[astro] ${app.store}/${app.appName}: ${error instanceof Error ? error.message : error}`);
    return [];
  }
};

const mergeOpportunities = (items) => {
  const merged = new Map();
  for (const item of items) {
    const key = `${item.store}#${normalizeKeyword(item.keyword)}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, item);
      continue;
    }
    const sources = [...current.sourceApps, ...item.sourceApps];
    merged.set(key, {
      ...current,
      appsCount: item.appsCount ?? current.appsCount,
      difficulty: item.difficulty,
      popularity: item.popularity,
      sourceApps: Array.from(new Map(sources.map((source) => [source.appId, source])).values()).slice(0, 12),
    });
  }
  return Array.from(merged.values());
};

const upload = async (runId, capturedAt, opportunities) => {
  if (!API_URL) throw new Error("Set APP_OPPORTUNITIES_API_URL before uploading.");
  if (!ACCESS_KEY) throw new Error("Set APP_OPPORTUNITIES_ACCESS_KEY before uploading.");
  let accepted = 0;
  for (let index = 0; index < opportunities.length; index += 50) {
    const batch = opportunities.slice(index, index + 50);
    const response = await fetch(`${API_URL}/app-opportunities/snapshots`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-Opportunities-Key": ACCESS_KEY,
      },
      body: JSON.stringify({ runId, capturedAt, opportunities: batch }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.message || `Opportunity API returned HTTP ${response.status}.`);
    accepted += Number(body?.accepted || batch.length);
  }
  return accepted;
};

const main = async () => {
  const countries = rotatingCountries();
  if (!countries.length) throw new Error("No valid countries were selected.");
  console.log(`[radar] countries: ${countries.join(", ")}`);
  const chartRequests = countries.flatMap((store) => FEEDS.map((chart) => ({ store, chart })));
  const chartGroups = await pool(chartRequests, 8, ({ store, chart }) => readRss(store, chart));
  const apps = countries.flatMap((store) => selectDiverseApps(
    chartGroups.flat().filter((entry) => entry.store === store)
  ));
  console.log(`[radar] selected ${apps.length} unrelated chart/new apps across ${countries.length} markets`);
  if (!apps.length) throw new Error("The approved Apple RSS feeds returned no apps.");

  const client = new AstroMcpClient(ASTRO_MCP_URL);
  await client.initialize();
  const suggestionGroups = await pool(apps, MCP_CONCURRENCY, (app) => suggestionsForApp(client, app));
  const merged = mergeOpportunities(suggestionGroups.flat());
  const selected = countries.flatMap((store) =>
    selectDiverseOpportunities(merged.filter((item) => item.store === store))
  );
  const runId = `astro-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  const capturedAt = new Date().toISOString();
  console.log(`[radar] ${selected.length} keywords passed popularity >20 and <=60`);

  if (noUpload) {
    console.log(JSON.stringify({ runId, capturedAt, countries, opportunities: selected }, null, 2));
    return;
  }
  const accepted = await upload(runId, capturedAt, selected);
  console.log(`[radar] uploaded ${accepted} snapshots to DynamoDB through the API`);
};

main().catch((error) => {
  console.error(`[radar] failed: ${error instanceof Error ? error.stack || error.message : error}`);
  process.exitCode = 1;
});
