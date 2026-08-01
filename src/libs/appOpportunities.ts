import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  BatchGetCommand,
  BatchWriteCommand,
  DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import { getOpenAiApiKey, getOpenAiConfig } from "@libs/openAi";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambda = new LambdaClient({});

export class AppOpportunityAccessError extends Error {
  constructor() {
    super("Invalid Opportunity Radar access key.");
    this.name = "AppOpportunityAccessError";
  }
}

export type OpportunitySourceApp = {
  appId: string;
  appName: string;
  category?: string;
  chart?: string;
  chartRank?: number;
  releaseDate?: string;
};

export type IncomingOpportunity = {
  appsCount?: number;
  difficulty: number;
  keyword: string;
  popularity: number;
  sourceApps?: OpportunitySourceApp[];
  store: string;
};

export type OpportunityIdea = {
  audience: string;
  buildComplexity: "low" | "medium" | "high";
  category: string;
  monetization: string;
  problem: string;
  productName: string;
  verdict: "explore" | "watch" | "skip";
  viabilityScore: number;
  whyNow: string;
};

export type OpportunityRecord = IncomingOpportunity &
  OpportunityIdea & {
    capturedAt: string;
    countryKeyword?: string;
    difficultyDelta?: number;
    entity: "LATEST" | "SNAPSHOT";
    id: string;
    normalizedKeyword: string;
    opportunityScore: number;
    popularityDelta?: number;
    runId: string;
    source: "astro-mcp";
  };

const tableName = () => {
  if (!process.env.appOpportunitiesTable) {
    throw new Error("Missing appOpportunitiesTable env var.");
  }
  return process.env.appOpportunitiesTable;
};

const header = (event: Pick<APIGatewayProxyEvent, "headers">, name: string) =>
  Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1] || "";

export const assertAppOpportunityAccess = (
  event: Pick<APIGatewayProxyEvent, "headers">
) => {
  const expected = process.env.APP_OPPORTUNITIES_ACCESS_KEY;
  if (!expected) throw new Error("Opportunity Radar access key is not configured.");
  const provided = header(event, "x-app-opportunities-key");
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    throw new AppOpportunityAccessError();
  }
};

export const appOpportunityErrorStatus = (error: unknown) =>
  error instanceof AppOpportunityAccessError ? 401 : 400;

const cleanText = (value: unknown, maxLength: number) =>
  String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maxLength);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export const normalizeOpportunityKeyword = (value: unknown) =>
  cleanText(value, 120).normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ");

const keywordHash = (store: string, normalizedKeyword: string) =>
  createHash("sha256")
    .update(`${store}#${normalizedKeyword}`)
    .digest("hex")
    .slice(0, 24);

const cleanSource = (value: unknown): OpportunitySourceApp | undefined => {
  const source = value as Partial<OpportunitySourceApp>;
  const appId = cleanText(source?.appId, 30);
  const appName = cleanText(source?.appName, 120);
  if (!appId || !appName) return undefined;
  return {
    appId,
    appName,
    category: cleanText(source.category, 80) || undefined,
    chart: cleanText(source.chart, 50) || undefined,
    chartRank: source.chartRank
      ? Math.round(clamp(Number(source.chartRank), 1, 500))
      : undefined,
    releaseDate: cleanText(source.releaseDate, 32) || undefined,
  };
};

const validateIncoming = (value: unknown): IncomingOpportunity => {
  const input = value as Partial<IncomingOpportunity>;
  const keyword = cleanText(input?.keyword, 120);
  const normalizedKeyword = normalizeOpportunityKeyword(keyword);
  const store = cleanText(input?.store, 3).toLowerCase();
  const popularity = Math.round(Number(input?.popularity));
  const difficulty = Math.round(Number(input?.difficulty));
  if (normalizedKeyword.length < 2) throw new Error("Each keyword must contain at least 2 characters.");
  if (!/^[a-z]{2,3}$/.test(store)) throw new Error(`Invalid App Store country code: ${store || "missing"}.`);
  if (!Number.isFinite(popularity) || popularity <= 20 || popularity > 60) {
    throw new Error(`Popularity for \"${keyword}\" must be greater than 20 and at most 60.`);
  }
  if (!Number.isFinite(difficulty) || difficulty < 0 || difficulty > 100) {
    throw new Error(`Difficulty for \"${keyword}\" must be between 0 and 100.`);
  }
  const sourceApps = Array.isArray(input.sourceApps)
    ? input.sourceApps.map(cleanSource).filter(Boolean).slice(0, 12) as OpportunitySourceApp[]
    : [];
  return {
    appsCount: Number.isFinite(Number(input.appsCount))
      ? Math.round(clamp(Number(input.appsCount), 0, 100_000))
      : undefined,
    difficulty,
    keyword,
    popularity,
    sourceApps,
    store,
  };
};

const fallbackIdea = (
  input: IncomingOpportunity,
  opportunityScore: number
): OpportunityIdea => {
  const value = input.keyword.toLocaleLowerCase();
  const rule = value.match(/exam|test|license|licen[cs]|driving|código|codigo|condu/)
    ? {
        category: "Education",
        productName: `${input.keyword} Prep`,
        audience: "People preparing for a local exam or certification",
        problem: "Practice and progress tracking are fragmented or not localized.",
        monetization: "Freemium question bank + one-time premium unlock",
        buildComplexity: "medium" as const,
      }
    : value.match(/scan|scanner|identify|identifier|value|price|tracker|track/)
      ? {
          category: "Utility",
          productName: `${input.keyword} Scanner`,
          audience: "Collectors and buyers who need a fast answer on mobile",
          problem: "Identifying, valuing, or tracking an item takes too many manual steps.",
          monetization: "Free scans + subscription or scan-credit packs",
          buildComplexity: "medium" as const,
        }
      : value.match(/sleep|dream|meditat|breath|habit|wellness|fitness|yoga|workout/)
        ? {
            category: "Health & Wellness",
            productName: `${input.keyword} Coach`,
            audience: "People seeking a focused daily wellness routine",
            problem: "General wellness apps do not serve this specific intent well.",
            monetization: "7-day trial + monthly content subscription",
            buildComplexity: "medium" as const,
          }
        : value.match(/budget|debt|invoice|tax|finance|expense|saving|money/)
          ? {
              category: "Finance",
              productName: `${input.keyword} Planner`,
              audience: "Consumers or solo businesses with a recurring money workflow",
              problem: "A high-frequency financial task is still handled in spreadsheets or notes.",
              monetization: "Free core workflow + annual pro plan",
              buildComplexity: "medium" as const,
            }
          : {
              category: "Focused Utility",
              productName: `${input.keyword} Companion`,
              audience: "People already searching for this exact outcome in this market",
              problem: "The search intent is specific enough for a simpler, localized product.",
              monetization: "Freemium utility + annual pro upgrade",
              buildComplexity: "low" as const,
            };
  return {
    ...rule,
    verdict: opportunityScore >= 66 ? "explore" : opportunityScore >= 48 ? "watch" : "skip",
    viabilityScore: opportunityScore,
    whyNow: "Validated by current App Store chart context and Astro ASO demand/competition signals.",
  };
};

const extractResponseText = (response: any) => {
  if (typeof response?.output_text === "string") return response.output_text;
  return (Array.isArray(response?.output) ? response.output : [])
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .map((content: any) => content?.text || "")
    .join("")
    .trim();
};

const parseJsonObject = (raw: string) => {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return JSON.parse(start >= 0 && end >= 0 ? raw.slice(start, end + 1) : raw);
};

const analyzeIdeas = async (
  inputs: Array<IncomingOpportunity & { key: string; opportunityScore: number }>
) => {
  const fallback = new Map(
    inputs.map((input) => [input.key, fallbackIdea(input, input.opportunityScore)])
  );
  if (!inputs.length) return fallback;
  try {
    const apiKey = await getOpenAiApiKey();
    const config = getOpenAiConfig();
    const model = process.env.APP_OPPORTUNITIES_MODEL || config.defaultModel;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_output_tokens: 7000,
        input: [
          {
            role: "system",
            content: `You are a skeptical mobile-app opportunity analyst for a solo developer. Turn ASO keyword evidence into small, buildable product hypotheses. Do not treat trademark typos, brand-navigation terms, generic one-word noise, or copyrighted clones as opportunities. Profitability is a hypothesis, never a promise. Favor narrow pains, local-market gaps, recurring workflows, clear monetization, and products a solo developer can test quickly. Return strict JSON only: {"ideas":[{"key":"same key","productName":"short original concept","category":"category","audience":"specific audience","problem":"pain solved","monetization":"specific business model","whyNow":"one evidence-based sentence","buildComplexity":"low|medium|high","verdict":"explore|watch|skip","viabilityScore":0}]}.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              instruction: "Analyze every candidate. Preserve each key exactly. Use the country, chart sources, popularity, difficulty, app count and preliminary score. Penalize branded/noisy queries.",
              candidates: inputs,
            }),
          },
        ],
      }),
    });
    const body = await response.json().catch(() => ({})) as any;
    if (!response.ok) throw new Error(body?.error?.message || "OpenAI opportunity analysis failed.");
    const ideas = parseJsonObject(extractResponseText(body))?.ideas;
    if (!Array.isArray(ideas)) return fallback;
    for (const value of ideas) {
      const key = cleanText(value?.key, 180);
      if (!fallback.has(key)) continue;
      const current = fallback.get(key)!;
      const complexity = ["low", "medium", "high"].includes(value?.buildComplexity)
        ? value.buildComplexity
        : current.buildComplexity;
      const verdict = ["explore", "watch", "skip"].includes(value?.verdict)
        ? value.verdict
        : current.verdict;
      fallback.set(key, {
        audience: cleanText(value?.audience, 260) || current.audience,
        buildComplexity: complexity,
        category: cleanText(value?.category, 80) || current.category,
        monetization: cleanText(value?.monetization, 220) || current.monetization,
        problem: cleanText(value?.problem, 300) || current.problem,
        productName: cleanText(value?.productName, 100) || current.productName,
        verdict,
        viabilityScore: Number.isFinite(Number(value?.viabilityScore))
          ? Math.round(clamp(Number(value.viabilityScore), 0, 100))
          : current.viabilityScore,
        whyNow: cleanText(value?.whyNow, 320) || current.whyNow,
      });
    }
  } catch (error) {
    console.warn(
      "[appOpportunities] AI analysis unavailable, using deterministic hypotheses:",
      error instanceof Error ? error.message : error
    );
  }
  return fallback;
};

const chunks = <T>(items: T[], size: number) => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const batchGetLatest = async (keys: string[]) => {
  const result = new Map<string, OpportunityRecord>();
  for (const keyChunk of chunks(keys, 100)) {
    const response = await db.send(new BatchGetCommand({
      RequestItems: { [tableName()]: { Keys: keyChunk.map((id) => ({ id })) } },
    }));
    for (const item of response.Responses?.[tableName()] || []) {
      result.set(String(item.id), item as OpportunityRecord);
    }
  }
  return result;
};

const batchWrite = async (items: OpportunityRecord[]) => {
  for (const itemChunk of chunks(items, 25)) {
    let pending: any[] = itemChunk.map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; pending.length && attempt < 5; attempt += 1) {
      const response = await db.send(new BatchWriteCommand({
        RequestItems: { [tableName()]: pending },
      }));
      pending = response.UnprocessedItems?.[tableName()] || [];
      if (pending.length) await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
    if (pending.length) throw new Error(`DynamoDB did not process ${pending.length} opportunity records.`);
  }
};

const queueOpportunityEnrichment = async (records: OpportunityRecord[]) => {
  const functionName = process.env.APP_OPPORTUNITIES_ENRICH_FUNCTION_NAME;
  if (!functionName) {
    console.warn("[appOpportunities] enrichment function is not configured; keeping deterministic hypotheses.");
    return;
  }
  for (const recordChunk of chunks(records, 60)) {
    await lambda.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: "Event",
      Payload: Buffer.from(JSON.stringify({ records: recordChunk })),
    }));
  }
};

export const enrichOpportunityRecords = async (rawRecords: unknown[]) => {
  const records = (Array.isArray(rawRecords) ? rawRecords : [])
    .filter((value): value is OpportunityRecord => {
      const record = value as Partial<OpportunityRecord>;
      return Boolean(
        record?.id &&
        (record.entity === "LATEST" || record.entity === "SNAPSHOT") &&
        record.keyword &&
        record.store &&
        Number.isFinite(record.opportunityScore)
      );
    });
  if (!records.length) return { enriched: 0 };
  const unique = new Map<string, OpportunityRecord>();
  for (const record of records) {
    unique.set(`${record.store}#${record.normalizedKeyword}`, record);
  }
  const ideas = await analyzeIdeas(Array.from(unique.entries()).map(([key, record]) => ({
    appsCount: record.appsCount,
    difficulty: record.difficulty,
    key,
    keyword: record.keyword,
    opportunityScore: record.opportunityScore,
    popularity: record.popularity,
    sourceApps: record.sourceApps,
    store: record.store,
  })));
  const enriched = records.map((record) => ({
    ...record,
    ...(ideas.get(`${record.store}#${record.normalizedKeyword}`) || fallbackIdea(record, record.opportunityScore)),
  }));
  await batchWrite(enriched);
  return { enriched: enriched.length };
};

const preliminaryScore = (
  item: IncomingOpportunity,
  previous?: OpportunityRecord
) => {
  const demand = ((item.popularity - 20) / 40) * 36;
  const competition = ((100 - item.difficulty) / 100) * 42;
  const scarcity = item.appsCount === undefined
    ? 4
    : ((300 - Math.min(300, item.appsCount)) / 300) * 7;
  const popularityDelta = previous ? item.popularity - previous.popularity : 0;
  const momentum = clamp(popularityDelta, 0, 10) * 1.2;
  const charts = item.sourceApps || [];
  const revenueSignal = charts.some((source) => source.chart?.includes("grossing")) ? 6 : 0;
  const paidSignal = charts.some((source) => source.chart?.includes("paid")) ? 3 : 0;
  return Math.round(clamp(demand + competition + scarcity + momentum + revenueSignal + paidSignal, 0, 100));
};

export const saveOpportunitySnapshots = async ({
  capturedAt,
  opportunities,
  runId,
}: {
  capturedAt?: string;
  opportunities: unknown[];
  runId?: string;
}) => {
  if (!Array.isArray(opportunities) || !opportunities.length) {
    throw new Error("Provide at least one opportunity snapshot.");
  }
  if (opportunities.length > 100) throw new Error("A snapshot request can contain at most 100 opportunities.");
  const deduped = new Map<string, IncomingOpportunity>();
  for (const raw of opportunities) {
    const item = validateIncoming(raw);
    const normalized = normalizeOpportunityKeyword(item.keyword);
    const key = `${item.store}#${normalized}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, item);
      continue;
    }
    const sources = [...(existing.sourceApps || []), ...(item.sourceApps || [])];
    deduped.set(key, {
      ...existing,
      appsCount: item.appsCount ?? existing.appsCount,
      difficulty: item.difficulty,
      popularity: item.popularity,
      sourceApps: Array.from(new Map(sources.map((source) => [source.appId, source])).values()).slice(0, 12),
    });
  }
  const timestamp = capturedAt && !Number.isNaN(Date.parse(capturedAt))
    ? new Date(capturedAt).toISOString()
    : new Date().toISOString();
  const resolvedRunId = cleanText(runId, 80) || randomUUID();
  const candidates = Array.from(deduped.entries()).map(([key, item]) => {
    const hash = keywordHash(item.store, normalizeOpportunityKeyword(item.keyword));
    return { key, hash, item, latestId: `latest#${item.store}#${hash}` };
  });
  const previous = await batchGetLatest(candidates.map((candidate) => candidate.latestId));
  const scored = candidates.map((candidate) => ({
    ...candidate,
    opportunityScore: preliminaryScore(candidate.item, previous.get(candidate.latestId)),
  }));
  const snapshots: OpportunityRecord[] = [];
  const latest: OpportunityRecord[] = [];
  for (const candidate of scored) {
    const normalizedKeyword = normalizeOpportunityKeyword(candidate.item.keyword);
    const prior = previous.get(candidate.latestId);
    const idea = fallbackIdea(candidate.item, candidate.opportunityScore);
    const common = {
      ...candidate.item,
      ...idea,
      capturedAt: timestamp,
      difficultyDelta: prior ? candidate.item.difficulty - prior.difficulty : undefined,
      normalizedKeyword,
      opportunityScore: candidate.opportunityScore,
      popularityDelta: prior ? candidate.item.popularity - prior.popularity : undefined,
      runId: resolvedRunId,
      source: "astro-mcp" as const,
    };
    snapshots.push({
      ...common,
      id: `snapshot#${resolvedRunId}#${candidate.item.store}#${candidate.hash}`,
      entity: "SNAPSHOT",
      countryKeyword: `${candidate.item.store}#${candidate.hash}`,
    });
    latest.push({
      ...common,
      id: candidate.latestId,
      entity: "LATEST",
    });
  }
  const records = [...snapshots, ...latest];
  await batchWrite(records);
  try {
    await queueOpportunityEnrichment(records);
  } catch (error) {
    console.warn(
      "[appOpportunities] could not queue AI enrichment; deterministic hypotheses remain available:",
      error instanceof Error ? error.message : error
    );
  }
  return {
    accepted: snapshots.length,
    countries: Array.from(new Set(snapshots.map((item) => item.store))).sort(),
    runId: resolvedRunId,
    capturedAt: timestamp,
  };
};
