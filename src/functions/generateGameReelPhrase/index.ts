import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { getGameContextsTableName } from "@libs/gameContexts";
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

const cleanPhrase = (value: string) =>
  value
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const gameId = event.pathParameters?.gameId;
    const body = event.body ? JSON.parse(event.body) : {};

    if (!gameId) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Missing gameId path parameter.",
        },
      });
    }

    const game = await dynamo.get(gameId, getGameContextsTableName());
    if (!game) {
      return formatJSONResponse({
        statusCode: 404,
        data: {
          message: "Game context not found.",
        },
      });
    }

    const apiKey = await getOpenAiApiKey();
    const config = getOpenAiConfig();
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
              requestedTone: body.tone || "challenge trailer",
            }),
          },
        ],
        max_output_tokens: 80,
        model: body.model || config.defaultModel,
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
      return formatJSONResponse({
        statusCode: response.status,
        data: {
          message:
            data?.error?.message || "Unable to generate a reel phrase with OpenAI.",
        },
      });
    }

    const phrase = cleanPhrase(extractText(data));
    if (!phrase) throw new Error("OpenAI returned an empty phrase.");

    return formatJSONResponse({
      data: {
        model: body.model || config.defaultModel,
        phrase,
      },
    });
  } catch (err) {
    console.log(err);
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: err instanceof Error ? err.message : "Unable to generate reel phrase.",
      },
    });
  }
};
