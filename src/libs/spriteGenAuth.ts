import { timingSafeEqual } from "crypto";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});
let cachedKey: string | undefined;

export const validateSpriteGenAccess = async (provided: unknown): Promise<string | null> => {
  const name = process.env.SPRITE_STUDIO_KEY_PARAM;
  if (!name) throw new Error("SPRITE_STUDIO_KEY_PARAM is not configured.");
  if (!cachedKey) {
    const result = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }));
    cachedKey = result.Parameter?.Value;
  }
  if (!cachedKey) throw new Error("Sprite Studio access key is missing.");
  const expected = Buffer.from(cachedKey);
  const actual = Buffer.from(String(provided || ""));
  return actual.length === expected.length && timingSafeEqual(actual, expected) ? cachedKey : null;
};
