import { getOpenAiApiKey, getOpenAiConfig } from "@libs/openAi";

/**
 * Script for the Cozy Dive template: three on-screen captions, a store CTA
 * line, and 1-2 spoken dialogue lines for ElevenLabs. Generated from the game
 * context so every game gets a fresh, specific script.
 */
export type CozyReelScript = {
  captionA: string;
  captionB: string;
  captionHook: string;
  ctaLine: string;
  voiceText: string;
};

const systemPrompt = `You write scripts for short vertical game reels (TikTok/Instagram/Shorts) promoting Swipe2Play, an app that works like a TikTok feed where every "video" is a playable mini game (swipe until one hooks you, tap play).

Return STRICT JSON only:
{"captionHook":"...","captionA":"...","captionB":"...","ctaLine":"...","voiceLines":["...","..."]}

Rules:
- captionHook: shown over a clip of someone swiping through games in the app. 6-9 words, sentence case, explains the "TikTok of games" concept or teases it. No emojis, no hashtags.
- captionA: shown over the first gameplay clip. 5-8 words introducing THIS game's cozy appeal. Sentence case.
- captionB: shown over the second gameplay clip. 5-9 words about what gets surprising/deeper/weirder. Create curiosity. Sentence case.
- ctaLine: 2-4 words, warm invite ("play it free", "your new cozy fix").
- voiceLines: 1-2 short spoken lines, total under 22 words, casual and warm like a friend recommending a game. They play over the gameplay. Mention the game's vibe, NOT the app name (the CTA handles that). No emojis.
- Everything in English. Specific to the provided game context - never generic. Do not invent features not in the context.`;

const extractText = (response: any): string => {
  if (typeof response?.output_text === "string") return response.output_text;
  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .map((content: any) => content?.text || "")
    .join("")
    .trim();
};

const clean = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export const generateCozyReelScript = async ({
  angleA,
  angleB,
  game,
  model,
}: {
  angleA?: string;
  angleB?: string;
  game: Record<string, any>;
  model?: string;
}): Promise<{ model: string; script: CozyReelScript }> => {
  const apiKey = await getOpenAiApiKey();
  const config = getOpenAiConfig();
  const selectedModel = model || config.defaultModel;

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
            game,
            clipAContext: angleA || "first gameplay clip: the bright, cozy side of the game",
            clipBContext:
              angleB || "second gameplay clip: the deeper, more surprising side of the game",
          }),
        },
      ],
      max_output_tokens: 400,
      model: selectedModel,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    throw new Error(data?.error?.message || "Unable to generate the reel script.");
  }

  const raw = extractText(data);
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart, jsonEnd + 1) : raw);
  } catch {
    throw new Error("OpenAI returned an unparseable reel script.");
  }

  const voiceLines = (Array.isArray(parsed.voiceLines) ? parsed.voiceLines : [])
    .map((line: unknown) => clean(line, 140))
    .filter(Boolean)
    .slice(0, 2);

  const script: CozyReelScript = {
    captionA: clean(parsed.captionA, 70) || "this one is a cozy little game",
    captionB: clean(parsed.captionB, 80) || "it gets deeper than you think",
    captionHook: clean(parsed.captionHook, 80) || "a TikTok where every video is a game",
    ctaLine: clean(parsed.ctaLine, 30) || "play it free",
    voiceText: voiceLines.join(" ") || "This cozy little game completely got me.",
  };

  return { model: selectedModel, script };
};
