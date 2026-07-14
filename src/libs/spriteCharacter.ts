import { getOpenAiApiKey, getOpenAiConfig } from "@libs/openAi";

/**
 * The AI only produces a compact "CharacterSpec". The 2D Sprite Animation Studio
 * frontend expands it into a full, guaranteed-valid project (SVG parts + rig +
 * keyframes) using its local engine. Keep this schema in sync with
 * Portfolio-du/SPRITE_STUDIO.md and src/lib/spriteStudio/characterSpec.ts.
 */

// Preset ids + their roles, mirrored from the studio's presets.ts.
const PRESET_REFERENCE = `
Available animation presets (use the id in "preset", fill "roles" with part names):
- idle: roles body(req), head
- walk: roles legFront(req), legBack(req), armFront, armBack, body
- run: roles legFront(req), legBack(req), armFront, armBack, body
- jump: roles body(req), legFront, legBack
- slash: roles arm(req), weapon, body        (horizontal attack)
- overhead: roles arm(req), weapon, body      (overhead attack)
- stab: roles arm(req), body
- cast: roles arm(req), body, effect
- hurt: roles body(req)
- death: roles body(req)
- swim: roles body(req), tail(req), fins[]    (fins can be an array of part names)
- fly: roles leftWing(req), rightWing(req), body
- bite: roles jaw(req)
- tailWag: roles tail(req)
- drive: roles wheels[](req), chassis          (wheels is an array of part names)
- turn: roles chassis(req)
- brake: roles chassis(req)
- open: roles lid(req), glow
- close: roles lid(req)
- float: roles body(req)
- pulse: roles body(req)
- shake: roles body(req)
- spin: roles body(req)
- uiAppear/uiDisappear/uiScalePop/uiLoading: roles element(req)
`;

const SHAPES =
  "none, roundedRect, rect, ellipse, circle, capsule, triangleUp, triangleDown, triangleLeft, triangleRight, diamond, hexagon";
const PIVOTS =
  "center, top, bottom, left, right, topLeft, topRight, bottomLeft, bottomRight";

const systemPrompt = `You design 2D game characters as riggable vector puppets for the "2D Sprite Animation Studio".
You do NOT draw pixels. You output a compact CharacterSpec JSON that describes body parts as simple shapes plus which animation presets to apply.

COORDINATE SYSTEM
- Canvas is ~512x512. Parts are positioned relative to their PARENT's pivot, in pixels.
- The origin (originX,originY as fractions 0..1) is where the root sits; use ~0.5,0.62 for standing characters, 0.5,0.5 for creatures/objects.
- A child's (x,y) is the offset of ITS pivot from the parent's pivot. Negative y is UP.
- Set "pivot" to the joint the part rotates around (e.g. a leg pivots at "top"=hip, an arm at "top"=shoulder, a lid at "bottom" hinge).

RULES
- 4 to 16 parts. First/root part is usually a "none" shape bone (hips/body/root) with no texture.
- Give each part a unique lowercase name. Use conventional role names when relevant: hips, torso, head, armFront, armBack, legFront, legBack, tail, leftWing, rightWing, wheels/wheel, chassis, lid, glow, weapon, eye, fin, body.
- Choose shape from: ${SHAPES}
- pivot from: ${PIVOTS}
- Colors are #rrggbb hex. Pick a coherent palette from the description.
- z is the draw order (higher = front).
- Add a FULL set of the most common movements for this character type (aim for 5 to 8), so the user has a ready checklist. Map every REQUIRED role of each preset to a part name. Suggested sets:
  - Humanoid / legged creature: idle, walk, run, jump, slash (or overhead), hurt, death (+ tailWag if it has a tail).
  - Fish / aquatic: swim, idle (use float on body), bite (use head/jaw), tailWag.
  - Flying creature: fly, idle, hurt, bite.
  - Vehicle: drive, turn, brake.
  - Object / chest / prop: open, close, idle (float), pulse.
  - UI element: uiAppear, uiDisappear, uiScalePop, uiLoading.
  Only include animations whose required roles exist on the character.
${PRESET_REFERENCE}

Return STRICT JSON only, no markdown, shaped exactly as:
{"spec":{
  "assetName":"kebab-name",
  "name":"Readable name",
  "canvas":{"width":512,"height":512,"originX":0.5,"originY":0.62},
  "parts":[
    {"name":"hips","parent":null,"shape":"none","x":0,"y":0,"z":0},
    {"name":"torso","parent":"hips","shape":"roundedRect","w":78,"h":108,"color":"#3b82f6","x":0,"y":-2,"pivot":"bottom","z":3},
    {"name":"head","parent":"torso","shape":"circle","w":60,"h":60,"color":"#f2c9a0","x":0,"y":-98,"pivot":"bottom","z":5},
    {"name":"armFront","parent":"torso","shape":"capsule","w":24,"h":104,"color":"#2563eb","x":28,"y":-88,"pivot":"top","z":6}
  ],
  "animations":[
    {"name":"idle","preset":"idle","roles":{"body":"torso","head":"head"}},
    {"name":"attack","preset":"slash","roles":{"arm":"armFront","body":"torso"}}
  ]
}}`;

export interface CharacterSpec {
  assetName?: string;
  name?: string;
  canvas?: { width?: number; height?: number; originX?: number; originY?: number };
  parts: Array<Record<string, unknown>>;
  animations?: Array<Record<string, unknown>>;
}

const extractText = (response: any): string => {
  if (typeof response?.output_text === "string") return response.output_text;
  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
    .map((content: any) => content?.text || "")
    .join("")
    .trim();
};

const parseSpec = (raw: string): CharacterSpec => {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const slice = start >= 0 && end >= 0 ? raw.slice(start, end + 1) : raw;
  let parsed: any;
  try {
    parsed = JSON.parse(slice);
  } catch {
    throw new Error("The AI returned an unparseable character.");
  }
  const spec = parsed?.spec ?? parsed;
  if (!spec || !Array.isArray(spec.parts) || spec.parts.length === 0) {
    throw new Error("The AI returned no character parts.");
  }
  return spec as CharacterSpec;
};

export const generateSpriteCharacter = async ({
  description,
  model,
}: {
  description: string;
  model?: string;
}): Promise<{ spec: CharacterSpec; model: string }> => {
  const apiKey = await getOpenAiApiKey();
  const config = getOpenAiConfig();
  const selectedModel = model || process.env.SPRITE_STUDIO_MODEL || config.defaultModel;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Design this character: ${description}`,
        },
      ],
      max_output_tokens: 2500,
      model: selectedModel,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    throw new Error(data?.error?.message || "Unable to generate the character with OpenAI.");
  }

  const spec = parseSpec(extractText(data));
  return { spec, model: selectedModel };
};
