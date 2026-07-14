import { getOpenAiApiKey } from "@libs/openAi";

const ALLOWED_MODELS = new Set(["gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini"]);

const assetDirections: Record<string, string> = {
  character: "a complete 2D game character, full body visible including feet, neutral readable silhouette",
  prop: "one isolated 2D game prop or interactable object",
  vegetation: "one isolated tree, plant, bush or natural vegetation asset",
  terrain: "one reusable 2D terrain tile or terrain element",
  building: "one isolated house, building or architectural game asset",
  environment: "one 2D environment or background plate with clear depth layers",
  effect: "one centered 2D game VFX asset with a clean readable silhouette",
  ui: "one polished 2D game UI element or icon",
};

const styleDirections: Record<string, string> = {
  painterly: "hand-painted 2D game art, soft texture, production-ready",
  cartoon: "clean stylized cartoon game art, bold silhouette, controlled details",
  pixel: "crisp pixel art, limited palette, no antialiasing, game-ready",
  bramblebound: "whimsical dark-fantasy woodland strategy game art, tactile painted shapes, warm highlights",
};

function parseReference(dataUrl: string): { bytes: Uint8Array; mime: string; extension: string } {
  const match = dataUrl.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) throw new Error("Reference must be a PNG, JPEG or WebP image.");
  const bytes = Uint8Array.from(Buffer.from(match[2], "base64"));
  if (bytes.byteLength > 4 * 1024 * 1024) throw new Error("Reference image is too large (max 4 MB).");
  const kind = match[1].toLowerCase();
  return {
    bytes,
    mime: kind === "jpg" || kind === "jpeg" ? "image/jpeg" : `image/${kind}`,
    extension: kind === "jpeg" ? "jpg" : kind,
  };
}

function buildPrompt(input: {
  description: string;
  assetType: string;
  style: string;
  workflow: string;
  movements: string[];
}): string {
  const subject = assetDirections[input.assetType] || assetDirections.prop;
  const style = styleDirections[input.style] || styleDirections.cartoon;
  const poseInstruction = input.workflow === "keyposes"
    ? `Create a horizontal three-pose key-pose sheet for ${input.movements[0] || "attack"}: anticipation, impact, recovery. Keep identity, proportions, clothing, weapon and palette identical across all three poses. Equal cells, no overlap.`
    : "Centered orthographic game-asset presentation. Keep generous empty margin around the asset.";
  return [
    "Create production-ready art for a 2D game asset pipeline.",
    `SUBJECT: ${subject}. ${input.description}`,
    `STYLE: ${style}.`,
    `LAYOUT: ${poseInstruction}`,
    "BACKGROUND: plain flat light-gray background with no shadow, scenery, border, labels or text; easy to remove locally.",
    "CONSTRAINTS: no watermark, no logo, no caption, no cropped parts, no duplicated limbs unless the requested key poses require separate full characters.",
  ].join("\n");
}

export const generateGameAsset = async (input: {
  description: string;
  assetType: string;
  style: string;
  workflow: string;
  model: string;
  movements: string[];
  referenceImage?: string;
}): Promise<{ imageDataUrl: string; model: string; revisedPrompt?: string }> => {
  const apiKey = await getOpenAiApiKey();
  const requestedModel = ALLOWED_MODELS.has(input.model) ? input.model : "gpt-image-2";
  const effectiveModel = input.referenceImage && requestedModel === "gpt-image-2"
    ? "gpt-image-1.5"
    : requestedModel;
  const prompt = buildPrompt(input);

  let response: Response;
  if (input.referenceImage) {
    const reference = parseReference(input.referenceImage);
    const form = new FormData();
    form.append("model", effectiveModel);
    form.append("prompt", `${prompt}\nREFERENCE: Preserve the reference subject's identity, silhouette, palette and equipment.`);
    form.append("image", new Blob([reference.bytes], { type: reference.mime }), `reference.${reference.extension}`);
    form.append("size", "1024x1024");
    form.append("quality", "medium");
    form.append("output_format", "webp");
    form.append("output_compression", "82");
    response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: effectiveModel,
        prompt,
        n: 1,
        size: "1024x1024",
        quality: "medium",
        output_format: "webp",
        output_compression: 82,
      }),
    });
  }

  const data = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) throw new Error(data?.error?.message || "Unable to generate the game asset.");
  const base64 = data?.data?.[0]?.b64_json;
  if (!base64) throw new Error("The image model returned no image.");
  return {
    imageDataUrl: `data:image/webp;base64,${base64}`,
    model: effectiveModel,
    revisedPrompt: data?.data?.[0]?.revised_prompt,
  };
};
