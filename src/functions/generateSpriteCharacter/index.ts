import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { generateSpriteCharacter } from "@libs/spriteCharacter";

/**
 * POST /sprite-studio/character
 * Body: { key: string, description: string, model?: string }
 * Returns a CharacterSpec that the 2D Sprite Animation Studio expands locally.
 *
 * The access key is a light gate to avoid random use of the paid OpenAI key
 * (which stays server-side). It is NOT strong auth.
 */
export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const accessKey = process.env.SPRITE_STUDIO_KEY || "daniel";
    if (String(body.key || "") !== accessKey) {
      return formatJSONResponse({
        statusCode: 401,
        data: { message: "Invalid access key." },
      });
    }

    const description = String(body.description || "").trim();
    if (!description) {
      return formatJSONResponse({
        statusCode: 400,
        data: { message: "Provide a character description." },
      });
    }
    if (description.length > 600) {
      return formatJSONResponse({
        statusCode: 400,
        data: { message: "Description is too long (max 600 characters)." },
      });
    }

    const { spec, model } = await generateSpriteCharacter({
      description,
      model: body.model ? String(body.model) : undefined,
    });

    return formatJSONResponse({
      data: { spec, model, message: "Character generated." },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: {
        message: error instanceof Error ? error.message : "Unable to generate the character.",
      },
    });
  }
};
