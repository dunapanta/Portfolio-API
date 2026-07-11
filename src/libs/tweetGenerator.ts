import { getOpenAiApiKey, getOpenAiConfig } from "@libs/openAi";

/**
 * Viral formats distilled from indie-hacking / build-in-public accounts
 * (levelsio, alexcooldev, marc lou, etc.). Kept in sync with TWEET_STUDIO.md.
 */
export const TWEET_FORMATS = [
  {
    id: "build-in-public",
    name: "Build in public update",
    guide:
      "Short hook first line under 10 words (e.g. 'Day 42 of building X:'). Then 1-2 lines on what shipped today + one honest number or lesson. Concrete > vague.",
  },
  {
    id: "before-after",
    name: "Before / After",
    guide:
      "Contrast two states. 'Yesterday: no game. Today: trigger_storm is live.' Great with a screenshot or clip.",
  },
  {
    id: "how-i-built",
    name: "How I built X in Y",
    guide:
      "'I built a full game in 1 day using Fable 5 + Tripo.' Specific stack, specific timeframe. People save these.",
  },
  {
    id: "contrarian",
    name: "Contrarian take",
    guide:
      "A punchy opinion that sparks debate but is defensible. Keep it classy, invite replies.",
  },
  {
    id: "lesson-learned",
    name: "Lesson / failure",
    guide:
      "Share a mistake and the fix. Vulnerability drives replies. One story, one takeaway.",
  },
  {
    id: "listicle",
    name: "Mini list",
    guide:
      "3-5 tight bullet points (use line breaks, not a thread). Tools, tips, or steps.",
  },
] as const;

export type TweetDraft = {
  format: string;
  hashtags: string[];
  text: string;
  threadParts?: string[];
};

const systemPrompt = `You are a ghostwriter for a solo indie hacker who ships mobile games and small apps. You write tweets for X in the voice of top build-in-public accounts (concise, specific, confident, no corporate tone, no emojis unless one lands naturally).

Hard rules:
- The main tweet text must be <= 260 characters (leave room for hashtags).
- First line is a strong hook under ~10 words.
- Prefer concrete numbers, tools, and outcomes over vague hype.
- Avoid links unless the user provided one (links reduce reach).
- 1-3 useful, specific hashtags max. No hashtag spam. Niche > generic.
- Do NOT invent metrics, revenue, or facts that are not in the context.
- Vary the formats across the drafts you return.

Return STRICT JSON only, shaped as:
{"drafts":[{"format":"<format id>","text":"<tweet>","hashtags":["#tag"],"threadParts":["optional follow-up tweet"]}]}`;

const extractText = (response: any): string => {
  if (typeof response?.output_text === "string") return response.output_text;
  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .map((content: any) => content?.text || "")
    .join("")
    .trim();
};

const parseDrafts = (raw: string): TweetDraft[] => {
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  const slice = jsonStart >= 0 && jsonEnd >= 0 ? raw.slice(jsonStart, jsonEnd + 1) : raw;

  let parsed: any;
  try {
    parsed = JSON.parse(slice);
  } catch {
    throw new Error("OpenAI returned an unparseable tweet response.");
  }

  const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
  return drafts
    .map((draft: any) => {
      const text = String(draft?.text ?? "").trim();
      if (!text) return undefined;
      const hashtags = Array.isArray(draft?.hashtags)
        ? draft.hashtags
            .map((tag: unknown) => {
              const value = String(tag ?? "").trim();
              if (!value) return "";
              return value.startsWith("#") ? value : `#${value.replace(/^#+/, "")}`;
            })
            .filter(Boolean)
        : [];
      const threadParts = Array.isArray(draft?.threadParts)
        ? draft.threadParts.map((p: unknown) => String(p ?? "").trim()).filter(Boolean)
        : undefined;
      return {
        format: String(draft?.format ?? "build-in-public"),
        hashtags,
        text: text.slice(0, 260),
        threadParts: threadParts?.length ? threadParts : undefined,
      } as TweetDraft;
    })
    .filter(Boolean) as TweetDraft[];
};

export const generateTweetDrafts = async ({
  context,
  count = 3,
  formats,
  model,
  tone,
}: {
  context: Record<string, unknown>;
  count?: number;
  formats?: string[];
  model?: string;
  tone?: string;
}): Promise<{ drafts: TweetDraft[]; model: string }> => {
  const apiKey = await getOpenAiApiKey();
  const config = getOpenAiConfig();
  const selectedModel =
    model || process.env.OPENAI_TWEET_MODEL || config.defaultModel;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            context,
            instructions: `Write ${count} distinct tweet drafts from this context.`,
            requestedFormats: formats?.length ? formats : "vary across formats",
            tone: tone || "confident indie builder",
            availableFormats: TWEET_FORMATS.map((f) => ({
              id: f.id,
              guide: f.guide,
            })),
          }),
        },
      ],
      max_output_tokens: 900,
      model: selectedModel,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    throw new Error(data?.error?.message || "Unable to generate tweets with OpenAI.");
  }

  const drafts = parseDrafts(extractText(data));
  if (!drafts.length) throw new Error("OpenAI returned no usable tweet drafts.");

  return { drafts, model: selectedModel };
};
