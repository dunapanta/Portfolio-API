import { generateGameAsset } from "@libs/gameAssetGenerator";
import {
  getSpriteAssetObject,
  putSpriteAssetObject,
  updateSpriteAssetJob,
} from "@libs/spriteAssetJobs";

type WorkerEvent = {
  jobId: string;
  input: {
    description: string;
    assetType: string;
    style: string;
    workflow: string;
    model: string;
    movements: string[];
    referenceKey?: string;
  };
};

export const handler = async ({ jobId, input }: WorkerEvent) => {
  try {
    await updateSpriteAssetJob(jobId, { status: "processing" });
    let referenceImage: string | undefined;
    if (input.referenceKey) {
      const bytes = await getSpriteAssetObject(input.referenceKey);
      const extension = input.referenceKey.split(".").pop()?.toLowerCase();
      const mime = extension === "jpg" ? "image/jpeg" : `image/${extension || "png"}`;
      referenceImage = `data:${mime};base64,${bytes.toString("base64")}`;
    }
    const result = await generateGameAsset({ ...input, referenceImage });
    const match = result.imageDataUrl.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) throw new Error("The image model returned an invalid image.");
    const extension = match[1] === "jpeg" ? "jpg" : match[1];
    const resultKey = `sprite-forge/jobs/${jobId}/result.${extension}`;
    await putSpriteAssetObject({
      body: Buffer.from(match[2], "base64"),
      contentType: match[1] === "jpg" || match[1] === "jpeg" ? "image/jpeg" : `image/${match[1]}`,
      key: resultKey,
    });
    await updateSpriteAssetJob(jobId, {
      status: "ready",
      resultKey,
      model: result.model,
      revisedPrompt: result.revisedPrompt,
    });
  } catch (error) {
    await updateSpriteAssetJob(jobId, {
      status: "failed",
      error: error instanceof Error ? error.message : "Unable to generate the asset.",
    });
  }
};

