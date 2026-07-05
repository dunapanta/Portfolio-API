import { getOpenAiApiKey, getOpenAiConfig } from "@libs/openAi";

const extractText = (response: any) => {
  if (typeof response?.output_text === "string") return response.output_text;

  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
    .map((content) => content?.text || "")
    .join(" ")
    .trim();
};

export const cleanReelPhrase = (value: string) =>
  value
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

export const generateGameReelPhraseText = async ({
  game,
  model,
  tone = "challenge trailer",
}: {
  game: Record<string, any>;
  model?: string;
  tone?: string;
}) => {
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
        {
          role: "system",
          content:
            "You write short, punchy English voiceover lines for mobile game reels. The line must sound like a challenge, feel natural when spoken, and create curiosity. Do not use emojis. Return only one line.",
        },
        {
          role: "user",
          content: JSON.stringify({
            game,
            instructions:
              "Write one 8-16 word line for this game. Make it specific to the gameplay. Mention Swipe2Play only if it feels natural.",
            requestedTone: tone,
          }),
        },
      ],
      max_output_tokens: 80,
      model: selectedModel,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    error?: {
      message?: string;
    };
    output?: unknown;
    output_text?: string;
  };

  if (!response.ok) {
    throw new Error(
      data?.error?.message || "Unable to generate a reel phrase with OpenAI."
    );
  }

  const phrase = cleanReelPhrase(extractText(data));
  if (!phrase) throw new Error("OpenAI returned an empty phrase.");

  return {
    model: selectedModel,
    phrase,
  };
};
