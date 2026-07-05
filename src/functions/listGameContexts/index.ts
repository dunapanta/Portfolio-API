import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import {
  defaultGameContexts,
  getGameContextsTableName,
  Swipe2PlayGameContext,
} from "@libs/gameContexts";

const seedMissingGameContexts = async (existing: Swipe2PlayGameContext[]) => {
  const tableName = getGameContextsTableName();
  const existingIds = new Set(existing.map((game) => game.gameId));
  const now = new Date().toISOString();
  const missing = defaultGameContexts.filter((game) => !existingIds.has(game.gameId));

  await Promise.all(
    missing.map((game) =>
      dynamo.write(
        {
          ...game,
          createdAt: now,
          id: game.gameId,
          updatedAt: now,
        },
        tableName
      )
    )
  );

  return missing.map((game) => ({
    ...game,
    createdAt: now,
    id: game.gameId,
    updatedAt: now,
  }));
};

export const handler = async (_event: APIGatewayProxyEvent) => {
  try {
    const tableName = getGameContextsTableName();
    const existing = ((await dynamo.getAll(tableName)) ?? []) as Swipe2PlayGameContext[];
    const seeded = await seedMissingGameContexts(existing);
    const games = [...existing, ...seeded].sort((a, b) =>
      (a.title || a.name).localeCompare(b.title || b.name)
    );

    return formatJSONResponse({
      data: {
        games,
        message: "Swipe2Play game contexts retrieved successfully.",
      },
    });
  } catch (err) {
    console.log(err);
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: err.message,
      },
    });
  }
};
