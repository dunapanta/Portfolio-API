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
  getRemotionLambdaConfig,
  startSwipe2PlayTemplateRender,
} from "@libs/remotionLambda";

const templateOneId = "swipe2play-hook-gameplay-v1";
const templateTwoId = "swipe2play-challenge-countdown-v1";
const fps = 30;
const defaultVoiceId = "FF7KdobWPaiR0vkcALHF";

// Template registry. To add a template: register it here, create the Remotion
// composition, and redeploy the Remotion site (see Portfolio-du/REEL_TEMPLATES.md).
const templates: Record<
  string,
  { label: string; requiresHook: boolean; getComposition: () => string }
> = {
  [templateOneId]: {
    label: "Template 1",
    requiresHook: true,
    getComposition: () => getRemotionLambdaConfig().composition,
  },
  [templateTwoId]: {
    label: "Template 2",
    requiresHook: false,
    getComposition: () => getRemotionLambdaConfig().templateTwoComposition,
  },
};

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
  let failedTemplateId = templateOneId;

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
    failedTemplateId = templateId;

    const template = templates[templateId];
    if (!template) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: `Unknown templateId. Supported: ${Object.keys(templates).join(", ")}.`,
        },
      });
    }

    if (!gameId || !gameplayAssetId || (template.requiresHook && !hookAssetId)) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: template.requiresHook
            ? "Missing gameId, hookAssetId or gameplayAssetId."
            : "Missing gameId or gameplayAssetId.",
        },
      });
    }

    const [game, hookAsset, gameplayAsset] = await Promise.all([
      dynamo.get(gameId, getGameContextsTableName()),
      template.requiresHook && hookAssetId
        ? getGameMediaAsset(hookAssetId)
        : Promise.resolve(undefined),
      getGameMediaAsset(gameplayAssetId),
    ]);

    if (!game) {
      return formatJSONResponse({
        statusCode: 404,
        data: { message: "Game context not found." },
      });
    }

    if (
      template.requiresHook &&
      (!hookAsset || hookAsset.gameId !== gameId || hookAsset.mediaKind !== "hook")
    ) {
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
      hookAsset ? createGameMediaDownloadUrl(hookAsset.key) : Promise.resolve(""),
      createGameMediaDownloadUrl(gameplayAsset.key),
      createDownloadUrl(voiceoverKey),
    ]);

    const hookFrames = hookAsset
      ? secondsToFrames(hookAsset.durationSeconds, 3)
      : 0;
    const gameplayFrames = secondsToFrames(gameplayAsset.durationSeconds, 8);
    const templateSlug = templateId === templateTwoId ? "template-2" : "template-1";
    const outputFileName = `swipe2play-${game.name || game.gameId}-${templateSlug}-${Date.now()}.mp4`;
    const outputKey = `swipe2play/reels/${reelId}/rendered/${outputFileName}`;
    const outputBucket = getReelAssetsBucketName();

    const gameTitle = game.title || game.name || "Swipe2Play";
    const inputProps: Record<string, unknown> =
      templateId === templateTwoId
        ? {
            appUrl: "swipe2play.app",
            challengeText: phrase,
            fps,
            gameTitle,
            gameplayDurationInFrames: gameplayFrames,
            gameplayVideoSrc,
            hookLine: String(body.hookLine || "").trim() || "ONLY 1% BEAT THIS",
            timerSeconds: Number(body.timerSeconds) > 0 ? Number(body.timerSeconds) : 10,
            voiceoverAudioSrc,
          }
        : {
            appUrl: "swipe2play.app",
            challengeText: phrase,
            fps,
            gameTitle,
            gameplayDurationInFrames: gameplayFrames,
            gameplayVideoSrc,
            hookDurationInFrames: hookFrames,
            hookVideoSrc,
            voiceoverAudioSrc,
          };

    const lambdaRender = await startSwipe2PlayTemplateRender({
      composition: template.getComposition(),
      inputProps,
      outName: {
        bucketName: outputBucket,
        key: outputKey,
      },
    });

    const durationFrames =
      templateId === templateTwoId ? gameplayFrames : hookFrames + gameplayFrames;
    const segments = [
      ...(hookAsset
        ? [
            {
              assetId: hookAsset.id,
              durationSeconds: hookAsset.durationSeconds,
              kind: "hook",
            },
          ]
        : []),
      {
        assetId: gameplayAsset.id,
        durationSeconds: gameplayAsset.durationSeconds,
        kind: "gameplay",
      },
    ];

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
        durationSeconds: durationFrames / fps,
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
      segments,
      source: "aws-remotion-template-render",
      status: "rendering",
      templateId,
      title: title || `${gameTitle} ${template.label}`,
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
          templateId: failedTemplateId,
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
