import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import {
  generateElevenLabsSpeech,
  getElevenLabsConfig,
} from "@libs/elevenLabs";
import {
  createAssetKey,
  createDownloadUrl,
  createReelId,
  getReelExpiry,
  putReelAssetObject,
} from "@libs/reelJobs";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const text = String(body.text || "").trim();
    if (!text) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Missing required field text.",
        },
      });
    }

    const config = getElevenLabsConfig();
    const voiceId = body.voiceId || config.defaultVoiceId;
    const outputFormat = body.outputFormat || config.defaultOutputFormat;
    const audioBuffer = await generateElevenLabsSpeech({
      modelId: body.modelId || config.defaultModelId,
      outputFormat,
      stability: body.stability,
      style: body.style,
      text,
      useSpeakerBoost: body.useSpeakerBoost,
      voiceId,
    });
    const voiceoverId = createReelId();
    const key = createAssetKey({
      fileName: `${voiceoverId}.mp3`,
      kind: "voiceover-audio",
      reelId: body.reelId || voiceoverId,
    });

    await putReelAssetObject({
      body: audioBuffer,
      contentType: "audio/mpeg",
      key,
    });

    return formatJSONResponse({
      data: {
        message: "Voiceover generated successfully.",
        voiceover: {
          contentType: "audio/mpeg",
          downloadUrl: await createDownloadUrl(key),
          expiresAt: getReelExpiry(),
          key,
          outputFormat,
          sizeBytes: audioBuffer.byteLength,
          text,
          voiceId,
          voiceoverId,
        },
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
