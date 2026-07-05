import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});

export type ElevenLabsVoiceoverRequest = {
  modelId?: string;
  outputFormat?: string;
  stability?: number;
  style?: number;
  text: string;
  useSpeakerBoost?: boolean;
  voiceId?: string;
};

const defaultVoiceId = "21m00Tcm4TlvDq8ikWAM";
const defaultModelId = "eleven_multilingual_v2";
const defaultOutputFormat = "mp3_44100_128";

let cachedApiKey: string | undefined;

export const getElevenLabsConfig = () => ({
  apiKeyParameterName:
    process.env.ELEVENLABS_API_KEY_PARAM || "/duportfolioapi/dev/elevenlabs/api-key",
  defaultModelId: process.env.ELEVENLABS_DEFAULT_MODEL_ID || defaultModelId,
  defaultOutputFormat: process.env.ELEVENLABS_DEFAULT_OUTPUT_FORMAT || defaultOutputFormat,
  defaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID || defaultVoiceId,
});

export const getElevenLabsApiKey = async () => {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  if (cachedApiKey) return cachedApiKey;

  const { apiKeyParameterName } = getElevenLabsConfig();
  const response = await ssm.send(
    new GetParameterCommand({
      Name: apiKeyParameterName,
      WithDecryption: true,
    })
  );

  const apiKey = response.Parameter?.Value;
  if (!apiKey) throw new Error("ElevenLabs API key is not configured in SSM.");

  cachedApiKey = apiKey;
  return apiKey;
};

export const generateElevenLabsSpeech = async ({
  modelId,
  outputFormat,
  stability = 0.45,
  style = 0.25,
  text,
  useSpeakerBoost = true,
  voiceId,
}: ElevenLabsVoiceoverRequest) => {
  if (!text?.trim()) throw new Error("Missing voiceover text.");

  const config = getElevenLabsConfig();
  const apiKey = await getElevenLabsApiKey();
  const selectedVoiceId = voiceId || config.defaultVoiceId;
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${selectedVoiceId}`);
  url.searchParams.set("output_format", outputFormat || config.defaultOutputFormat);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      model_id: modelId || config.defaultModelId,
      text: text.trim(),
      voice_settings: {
        stability,
        style,
        use_speaker_boost: useSpeakerBoost,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs speech generation failed: ${errorText}`);
  }

  return Buffer.from(await response.arrayBuffer());
};
