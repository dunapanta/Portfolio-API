import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});

const defaultModel = "gpt-5.4-mini";

let cachedApiKey: string | undefined;

export const getOpenAiConfig = () => ({
  apiKeyParameterName:
    process.env.OPENAI_API_KEY_PARAM || "/duportfolioapi/dev/openai/api-key",
  defaultModel: process.env.OPENAI_DEFAULT_MODEL || defaultModel,
});

export const getOpenAiApiKey = async () => {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (cachedApiKey) return cachedApiKey;

  const { apiKeyParameterName } = getOpenAiConfig();
  const response = await ssm.send(
    new GetParameterCommand({
      Name: apiKeyParameterName,
      WithDecryption: true,
    })
  );

  const apiKey = response.Parameter?.Value;
  if (!apiKey) throw new Error("OpenAI API key is not configured in SSM.");

  cachedApiKey = apiKey;
  return apiKey;
};
