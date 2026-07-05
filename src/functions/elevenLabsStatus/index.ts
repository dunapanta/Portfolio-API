import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { getElevenLabsApiKey, getElevenLabsConfig } from "@libs/elevenLabs";

export const handler = async (_event: APIGatewayProxyEvent) => {
  const config = getElevenLabsConfig();

  try {
    await getElevenLabsApiKey();

    return formatJSONResponse({
      data: {
        configured: true,
        defaultModelId: config.defaultModelId,
        defaultVoiceId: config.defaultVoiceId,
        message: "ElevenLabs is configured through AWS SSM.",
      },
    });
  } catch (error) {
    return formatJSONResponse({
      data: {
        configured: false,
        defaultModelId: config.defaultModelId,
        defaultVoiceId: config.defaultVoiceId,
        message:
          error instanceof Error ? error.message : "ElevenLabs is not configured.",
      },
    });
  }
};
