import { getOpenAiApiKey, getOpenAiConfig } from "@libs/openAi";

/**
 * Per-platform publish copy for a reel. Short, download-driving, and always
 * carrying the site URL. Generated once when the reel is scheduled.
 */
export type ReelPlatformCaptions = {
  facebook: { description: string; title: string };
  instagram: { caption: string };
  youtube: {
    description: string;
    privacyStatus: string;
    tags: string[];
    title: string;
  };
};

const SITE = "http://swipe2play.app/";

const systemPrompt = `You write publish copy for short game reels promoting Swipe2Play (an app that is like TikTok, but every video is a playable mini game). The copy must be short, warm, and make people want to download.

Return STRICT JSON only:
{"instagram":{"caption":"..."},"facebook":{"title":"...","description":"..."},"youtube":{"title":"...","description":"...","tags":["..."]}}

Rules:
- instagram.caption: 1-2 short lines + exactly 4-6 niche hashtags (mix of cozy/gaming + the game's theme). End with "Play free: ${SITE}". Max 300 chars. One emoji max.
- facebook.title: max 60 chars, the game name can appear.
- facebook.description: 1-2 lines + "Play free: ${SITE}". Max 200 chars.
- youtube.title: max 85 chars, must end with " #Shorts". Curiosity-driven.
- youtube.description: 2 lines + "Play free: ${SITE}" + 2-3 hashtags. Max 350 chars.
- youtube.tags: 6-10 short tags (no # symbol).
- Specific to the game context provided, never generic. English.`;

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

export const generateReelPlatformCaptions = async ({
  game,
  model,
  reelSummary,
}: {
  game: Record<string, any>;
  model?: string;
  reelSummary?: string;
}): Promise<{ captions: ReelPlatformCaptions; model: string }> => {
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
            reelSummary: reelSummary || "cozy hook + gameplay reel with voiceover",
          }),
        },
      ],
      max_output_tokens: 500,
      model: selectedModel,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    throw new Error(data?.error?.message || "Unable to generate platform captions.");
  }

  const raw = extractText(data);
  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart, jsonEnd + 1) : raw);
  } catch {
    throw new Error("OpenAI returned unparseable platform captions.");
  }

  const gameTitle = String(game.title || game.name || "Swipe2Play");
  const fallbackLine = `${gameTitle} — play free: ${SITE}`;

  const captions: ReelPlatformCaptions = {
    facebook: {
      description:
        clean(parsed?.facebook?.description, 220) || fallbackLine,
      title: clean(parsed?.facebook?.title, 70) || gameTitle,
    },
    instagram: {
      caption: clean(parsed?.instagram?.caption, 320) || fallbackLine,
    },
    youtube: {
      description: clean(parsed?.youtube?.description, 380) || fallbackLine,
      privacyStatus: "public",
      tags: (Array.isArray(parsed?.youtube?.tags) ? parsed.youtube.tags : [])
        .map((tag: unknown) => clean(tag, 30))
        .filter(Boolean)
        .slice(0, 10),
      title:
        clean(parsed?.youtube?.title, 90) ||
        `${gameTitle} is your next cozy obsession #Shorts`,
    },
  };

  if (!captions.youtube.tags.length) {
    captions.youtube.tags = ["swipe2play", "cozy games", "mobile games", "shorts"];
  }
  if (!captions.youtube.title.toLowerCase().includes("#shorts")) {
    captions.youtube.title = `${captions.youtube.title} #Shorts`.slice(0, 95);
  }

  return { captions, model: selectedModel };
};
