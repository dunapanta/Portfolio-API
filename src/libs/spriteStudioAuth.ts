export const getSpriteStudioAccessKey = () => {
  const accessKey = String(process.env.SPRITE_STUDIO_KEY || "").trim();
  if (!accessKey) throw new Error("SPRITE_STUDIO_KEY is not configured.");
  return accessKey;
};

export const validateSpriteStudioAccessKey = (value: unknown) => {
  const accessKey = getSpriteStudioAccessKey();
  return String(value || "") === accessKey ? accessKey : null;
};

