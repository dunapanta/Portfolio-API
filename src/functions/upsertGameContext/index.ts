import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { getGameContextsTableName } from "@libs/gameContexts";

const arrayFields = ["coreMechanics", "hookAngles", "keywords", "obstacles"] as const;

const normalizeList = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split("\n")
      .flatMap((line) => line.split(","))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const normalizeGameContext = (body: Record<string, any>) => {
  const gameId = String(body.gameId || body.id || "").trim();
  const name = String(body.name || gameId.replace(/^game_/, "")).trim();
  const title = String(body.title || name).trim();

  if (!gameId) throw new Error("Missing required field gameId.");
  if (!title) throw new Error("Missing required field title.");

  const data: Record<string, any> = {
    color: body.color,
    gameId,
    gameplaySummary: body.gameplaySummary,
    id: gameId,
    isPublished: body.isPublished ?? true,
    leaderboardMetric: body.leaderboardMetric,
    name,
    notes: body.notes,
    playerGoal: body.playerGoal,
    reelPrompt: body.reelPrompt,
    scoring: body.scoring,
    targetAudience: body.targetAudience,
    theme: body.theme,
    title,
    videoAssetPath: body.videoAssetPath,
  };

  arrayFields.forEach((field) => {
    data[field] = normalizeList(body[field]);
  });

  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined && value !== "")
  );
};

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const gameId = event.pathParameters?.gameId;
    const tableName = getGameContextsTableName();
    const now = new Date().toISOString();
    const data = normalizeGameContext({
      ...body,
      gameId: body.gameId || body.id || gameId,
    });
    const existing = await dynamo.get(data.gameId, tableName);
    const game = {
      ...existing,
      ...data,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await dynamo.write(game, tableName);

    return formatJSONResponse({
      data: {
        game,
        message: "Swipe2Play game context saved successfully.",
      },
    });
  } catch (err) {
    console.log(err);
    return formatJSONResponse({
      statusCode: err.message?.startsWith("Missing required") ? 400 : 500,
      data: {
        message: err.message,
      },
    });
  }
};
