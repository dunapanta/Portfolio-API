import {
  getFunctions,
  getRenderProgress,
  renderMediaOnLambda,
} from "@remotion/lambda/client";
import type { AwsRegion } from "@remotion/lambda/client";
import type { OutNameInput } from "@remotion/serverless/client";

const defaultRegion = "us-east-1";
const defaultComposition = "Swipe2PlayHookGameplayTemplate";
const defaultFramesPerLambda = 30;

export type Swipe2PlayTemplateOneRenderInput = {
  appUrl: string;
  challengeText: string;
  fps: number;
  gameTitle: string;
  gameplayDurationInFrames: number;
  gameplayVideoSrc: string;
  hookDurationInFrames: number;
  hookVideoSrc: string;
  voiceoverAudioSrc: string;
};

export const getRemotionLambdaConfig = () => ({
  composition:
    process.env.REMOTION_TEMPLATE_ONE_COMPOSITION || defaultComposition,
  framesPerLambda: Number(
    process.env.REMOTION_FRAMES_PER_LAMBDA || defaultFramesPerLambda
  ),
  functionName: process.env.REMOTION_LAMBDA_FUNCTION_NAME || "",
  region: (process.env.REMOTION_AWS_REGION || defaultRegion) as AwsRegion,
  serveUrl: process.env.REMOTION_SERVE_URL || "",
});

const getFunctionName = async () => {
  const config = getRemotionLambdaConfig();
  if (config.functionName) return config.functionName;

  const functions = await getFunctions({
    compatibleOnly: true,
    region: config.region,
  });

  const functionName = functions[0]?.functionName;
  if (!functionName) {
    throw new Error(
      "No compatible Remotion Lambda function found. Deploy one and set REMOTION_LAMBDA_FUNCTION_NAME."
    );
  }

  return functionName;
};

export const assertRemotionServeUrl = () => {
  const { serveUrl } = getRemotionLambdaConfig();
  if (!serveUrl) {
    throw new Error(
      "Missing REMOTION_SERVE_URL. Deploy the Remotion site to AWS S3 and set this env var."
    );
  }

  return serveUrl;
};

export const startSwipe2PlayTemplateOneRender = async ({
  inputProps,
  outName,
}: {
  inputProps: Swipe2PlayTemplateOneRenderInput;
  outName: OutNameInput<any>;
}) => {
  const config = getRemotionLambdaConfig();
  const functionName = await getFunctionName();
  const serveUrl = assertRemotionServeUrl();

  const result = await renderMediaOnLambda({
    codec: "h264",
    composition: config.composition,
    deleteAfter: "7-days",
    downloadBehavior: {
      type: "download",
      fileName:
        typeof outName === "string"
          ? outName.split("/").pop() || "swipe2play-reel.mp4"
          : outName.key.split("/").pop() || "swipe2play-reel.mp4",
    },
    framesPerLambda: Number.isFinite(config.framesPerLambda)
      ? config.framesPerLambda
      : defaultFramesPerLambda,
    functionName,
    imageFormat: "jpeg",
    inputProps,
    maxRetries: 1,
    outName,
    overwrite: true,
    privacy: "private",
    region: config.region,
    serveUrl,
  });

  return {
    ...result,
    functionName,
    region: config.region,
    serveUrl,
  };
};

export const getSwipe2PlayRenderProgress = async ({
  bucketName,
  functionName,
  region,
  renderId,
}: {
  bucketName: string;
  functionName: string;
  region: AwsRegion;
  renderId: string;
}) =>
  getRenderProgress({
    bucketName,
    functionName,
    region,
    renderId,
  });
