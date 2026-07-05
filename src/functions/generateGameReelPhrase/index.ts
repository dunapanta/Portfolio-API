import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { generateGameReelPhraseText } from "@libs/gameReelPhrase";
import { getGameContextsTableName } from "@libs/gameContexts";

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

    const generated = await generateGameReelPhraseText({
      game,
      model: body.model,
      tone: body.tone || "challenge trailer",
    });

    return formatJSONResponse({
      data: {
        model: generated.model,
        phrase: generated.phrase,
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
