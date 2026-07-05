import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { getOpenAiApiKey, getOpenAiConfig } from "@libs/openAi";

export const handler = async (_event: APIGatewayProxyEvent) => {
  const config = getOpenAiConfig();

  try {
    await getOpenAiApiKey();

    return formatJSONResponse({
      data: {
        configured: true,
        defaultModel: config.defaultModel,
        message: "OpenAI is configured through AWS SSM.",
      },
    });
  } catch (error) {
    return formatJSONResponse({
      data: {
        configured: false,
        defaultModel: config.defaultModel,
        message:
          error instanceof Error ? error.message : "OpenAI is not configured.",
      },
    });
  }
};
