import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import { generateElevenLabsSpeech, getElevenLabsConfig } from "@libs/elevenLabs";
import { generateGameReelPhraseText } from "@libs/gameReelPhrase";
import { getGameContextsTableName } from "@libs/gameContexts";
import {
  createGameMediaDownloadUrl,
  getGameMediaAssetsTableName,
  Swipe2PlayGameMediaAsset,
} from "@libs/gameMedia";
import {
  createAssetKey,
  createDownloadUrl,
  createReelId,
  getReelAssetsBucketName,
  getReelExpiry,
  getReelJobsTableName,
  putReelAssetObject,
} from "@libs/reelJobs";
import {
  startSwipe2PlayTemplateOneRender,
  Swipe2PlayTemplateOneRenderInput,
} from "@libs/remotionLambda";

const templateOneId = "swipe2play-hook-gameplay-v1";
const fps = 30;
const defaultVoiceId = "FF7KdobWPaiR0vkcALHF";

const secondsToFrames = (seconds: unknown, fallbackSeconds: number) => {
  const parsed = Number(seconds);
  const safeSeconds =
    Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackSeconds;
  return Math.max(1, Math.round(safeSeconds * fps));
};

const appendSwipe2Play = (phrase: string) =>
  /swipe\s*2\s*play|swipe2play/i.test(phrase)
    ? phrase
    : `${phrase} Play it on Swipe2Play.`;

const getGameMediaAsset = async (assetId: string) =>
  (await dynamo.get(assetId, getGameMediaAssetsTableName())) as
    | Swipe2PlayGameMediaAsset
    | undefined;

export const handler = async (event: APIGatewayProxyEvent) => {
  const now = new Date().toISOString();
  let reelId = "";

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const {
      gameId,
      gameplayAssetId,
      hookAssetId,
      model,
      phrase: rawPhrase,
      templateId = templateOneId,
      title,
    } = body;

    if (templateId !== templateOneId) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Only Template 1 is supported right now.",
        },
      });
    }

    if (!gameId || !hookAssetId || !gameplayAssetId) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Missing gameId, hookAssetId or gameplayAssetId.",
        },
      });
    }

    const [game, hookAsset, gameplayAsset] = await Promise.all([
      dynamo.get(gameId, getGameContextsTableName()),
      getGameMediaAsset(hookAssetId),
      getGameMediaAsset(gameplayAssetId),
    ]);

    if (!game) {
      return formatJSONResponse({
        statusCode: 404,
        data: { message: "Game context not found." },
      });
    }

    if (!hookAsset || hookAsset.gameId !== gameId || hookAsset.mediaKind !== "hook") {
      return formatJSONResponse({
        statusCode: 404,
        data: { message: "Hook video not found for this game." },
      });
    }

    if (
      !gameplayAsset ||
      gameplayAsset.gameId !== gameId ||
      gameplayAsset.mediaKind !== "gameplay"
    ) {
      return formatJSONResponse({
        statusCode: 404,
        data: { message: "Gameplay video not found for this game." },
      });
    }

    reelId = createReelId();
    const expiresAt = getReelExpiry();
    const phrase = String(rawPhrase || "").trim()
      ? String(rawPhrase).trim()
      : (
          await generateGameReelPhraseText({
            game,
            model,
            tone: "short mobile game challenge",
          })
        ).phrase;
    const voiceText = appendSwipe2Play(phrase);

    const elevenLabsConfig = getElevenLabsConfig();
    const voiceId = body.voiceId || defaultVoiceId;
    const audioBuffer = await generateElevenLabsSpeech({
      modelId: body.elevenLabsModelId || elevenLabsConfig.defaultModelId,
      outputFormat: body.outputFormat || elevenLabsConfig.defaultOutputFormat,
      stability: body.stability ?? 0.5,
      style: body.style ?? 0.65,
      text: voiceText,
      useSpeakerBoost: body.useSpeakerBoost ?? true,
      voiceId,
    });
    const voiceoverKey = createAssetKey({
      fileName: `${reelId}-voiceover.mp3`,
      kind: "voiceover-audio",
      reelId,
    });

    await putReelAssetObject({
      body: audioBuffer,
      contentType: "audio/mpeg",
      key: voiceoverKey,
    });

    const [hookVideoSrc, gameplayVideoSrc, voiceoverAudioSrc] = await Promise.all([
      createGameMediaDownloadUrl(hookAsset.key),
      createGameMediaDownloadUrl(gameplayAsset.key),
      createDownloadUrl(voiceoverKey),
    ]);

    const hookFrames = secondsToFrames(hookAsset.durationSeconds, 3);
    const gameplayFrames = secondsToFrames(gameplayAsset.durationSeconds, 8);
    const outputFileName = `swipe2play-${game.name || game.gameId}-template-1-${Date.now()}.mp4`;
    const outputKey = `swipe2play/reels/${reelId}/rendered/${outputFileName}`;
    const outputBucket = getReelAssetsBucketName();
    const inputProps: Swipe2PlayTemplateOneRenderInput = {
      appUrl: "swipe2play.app",
      challengeText: phrase,
      fps,
      gameTitle: game.title || game.name || "Swipe2Play",
      gameplayDurationInFrames: gameplayFrames,
      gameplayVideoSrc,
      hookDurationInFrames: hookFrames,
      hookVideoSrc,
      voiceoverAudioSrc,
    };

    const lambdaRender = await startSwipe2PlayTemplateOneRender({
      inputProps,
      outName: {
        bucketName: outputBucket,
        key: outputKey,
      },
    });

    const reelJob = {
      id: reelId,
      assets: [
        {
          contentType: "audio/mpeg",
          fileName: `${reelId}-voiceover.mp3`,
          key: voiceoverKey,
          kind: "voiceover-audio",
          sizeBytes: audioBuffer.byteLength,
          uploadedAt: now,
        },
      ],
      createdAt: now,
      expiresAt,
      gameId,
      render: {
        durationSeconds: (hookFrames + gameplayFrames) / fps,
        fileName: outputFileName,
        inputProps,
        lambda: {
          bucketName: lambdaRender.bucketName,
          cloudWatchLogs: lambdaRender.cloudWatchLogs,
          folderInS3Console: lambdaRender.folderInS3Console,
          functionName: lambdaRender.functionName,
          outKey: outputKey,
          outputBucket,
          progress: 0,
          region: lambdaRender.region,
          renderId: lambdaRender.renderId,
          serveUrl: lambdaRender.serveUrl,
        },
        phrase,
        voiceText,
      },
      segments: [
        {
          assetId: hookAsset.id,
          durationSeconds: hookAsset.durationSeconds,
          kind: "hook",
        },
        {
          assetId: gameplayAsset.id,
          durationSeconds: gameplayAsset.durationSeconds,
          kind: "gameplay",
        },
      ],
      source: "aws-remotion-template-render",
      status: "rendering",
      templateId,
      title: title || `${game.title || game.name} Template 1`,
      updatedAt: now,
    };

    await dynamo.write(reelJob, getReelJobsTableName());

    return formatJSONResponse({
      statusCode: 202,
      data: {
        message: "Template render started in AWS.",
        reel: reelJob,
      },
    });
  } catch (err) {
    console.log(err);

    if (reelId) {
      await dynamo.write(
        {
          id: reelId,
          createdAt: now,
          error: err instanceof Error ? err.message : "Unable to start render.",
          source: "aws-remotion-template-render",
          status: "failed",
          templateId: templateOneId,
          updatedAt: new Date().toISOString(),
        },
        getReelJobsTableName()
      );
    }

    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: err instanceof Error ? err.message : "Unable to start render.",
      },
    });
  }
};
