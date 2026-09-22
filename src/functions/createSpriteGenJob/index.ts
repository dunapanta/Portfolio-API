import { APIGatewayProxyEvent } from "aws-lambda";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { fileTypeFromBuffer } from "file-type";
import { formatJSONResponse } from "@libs/apiGateway";
import { validateSpriteGenAccess } from "@libs/spriteGenAuth";
import { spriteAssetOwnerId } from "@libs/spriteAssets";
import { createSpriteGenJob, failSpriteGenJob, newSpriteGenJobId, putSpriteGenReference, SpriteGenJob } from "@libs/spriteGenJobs";

const lambda = new LambdaClient({});
const MODELS = new Set(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2"]);
const STATES = new Set(["idle", "walk", "run", "jump", "attack", "wave", "hurt", "celebrate", "blink", "talk"]);
const QUALITIES = new Set(["low", "medium", "high", "xhigh", "max", "auto"]);

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const accessKey = await validateSpriteGenAccess(body.key);
    if (!accessKey) return formatJSONResponse({ statusCode: 401, data: { message: "Clave de acceso incorrecta." } });
    const description = String(body.description || "").trim();
    const style = String(body.style || "pixel art").trim();
    const direction = String(body.direction || "right");
    const model = String(body.model || "gpt-image-2.5-flare");
    const quality = String(body.quality || "medium");
    const states: string[] = Array.isArray(body.states)
      ? [...new Set<string>(body.states.map((value: unknown) => String(value)))] : [];
    if (description.length < 5 || description.length > 700) throw new Error("Describe el personaje en 5 a 700 caracteres.");
    if (!style || style.length > 120) throw new Error("El estilo debe tener hasta 120 caracteres.");
    if (!["front", "right", "left"].includes(direction)) throw new Error("Dirección no válida.");
    if (!MODELS.has(model)) throw new Error("Modelo de imagen no válido.");
    if (!QUALITIES.has(quality)) throw new Error("Calidad no válida.");
    if (model === "gpt-image-2" && !["low", "medium", "high", "auto"].includes(quality)) {
      throw new Error("GPT-Image-2 admite calidad low, medium, high o auto.");
    }
    if (states.length < 1 || states.length > 4 || states.some((state) => !STATES.has(state))) {
      throw new Error("Elige de uno a cuatro movimientos válidos.");
    }
    const id = newSpriteGenJobId();
    const prefix = `sprite-gen/${spriteAssetOwnerId(accessKey)}/${id}`;
    let referenceKey: string | undefined;
    if (body.referenceImage) {
      const image = String(body.referenceImage);
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image);
      if (!match) throw new Error("La referencia debe ser PNG, JPEG o WebP.");
      const bytes = Buffer.from(match[2], "base64");
      if (!bytes.length || bytes.length > 4 * 1024 * 1024) throw new Error("La referencia debe pesar menos de 4 MB.");
      const actual = await fileTypeFromBuffer(bytes);
      if (!actual || !["image/png", "image/jpeg", "image/webp"].includes(actual.mime)) throw new Error("El archivo de referencia no es una imagen válida.");
      referenceKey = `${prefix}/reference.${actual.ext}`;
      await putSpriteGenReference(referenceKey, bytes, actual.mime);
    }
    const now = new Date().toISOString();
    const job: SpriteGenJob = {
      id, ownerId: spriteAssetOwnerId(accessKey), status: "queued", stage: "queued", createdAt: now,
      updatedAt: now, description, style, direction, model, quality, states, referenceKey,
      resultPrefix: prefix, costStatus: "pending",
    };
    await createSpriteGenJob(job);
    try {
      const functionName = process.env.SPRITE_GEN_WORKER_FUNCTION_NAME;
      if (!functionName) throw new Error("Sprite worker no configurado.");
      await lambda.send(new InvokeCommand({ FunctionName: functionName, InvocationType: "Event", Payload: Buffer.from(JSON.stringify({ jobId: id })) }));
    } catch (error) {
      await failSpriteGenJob(id, error instanceof Error ? error.message : "No se pudo iniciar la generación.");
      throw error;
    }
    return formatJSONResponse({ statusCode: 202, data: { jobId: id, status: "queued" } });
  } catch (error) {
    return formatJSONResponse({ statusCode: 400, data: { message: error instanceof Error ? error.message : "No se pudo crear el sprite." } });
  }
};
