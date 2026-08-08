import { extractText } from "unpdf";

import { getOpenAiApiKey } from "@libs/openAi";
import { PROMPT_VERSION } from "./normalizer";
import { remateExtractionSchema } from "./extractionSchema";
import { DocumentExtraction } from "./types";

const EXTRACTION_PROMPT = `Eres un extractor de información de avisos oficiales de remates de bienes inmuebles en Ecuador.

Extrae exclusivamente información respaldada por el documento. No inventes valores ni fechas. Devuelve null cuando no exista evidencia suficiente.

Reglas críticas:
- El documento oficial prevalece sobre la ficha web.
- Distingue una alícuota de propiedad horizontal de un remate parcial de acciones y derechos.
- "50% de acciones y derechos" significa ownershipPercentage=50 e isFullOwnership=false.
- Una alícuota de áreas comunes de un departamento completo no significa que se remate solo una parte. Si el documento describe la unidad completa y no limita acciones y derechos, puede ser isFullOwnership=true.
- Nunca registres una alícuota de propiedad horizontal como evidence.field="ownershipPercentage". Ese campo y su evidencia describen únicamente el porcentaje de acciones y derechos efectivamente rematado; para una alícuota horizontal usa evidence.field="isPropertyHorizontal" y conserva ownershipPercentage=100 cuando se remata la unidad completa.
- Si la propiedad es ambigua, usa isFullOwnership=null y agrega OWNERSHIP_REQUIRES_REVIEW.
- No derives la base por el número de señalamiento. Solo calcula una fracción cuando el documento la declara expresamente; explica la derivación.
- No confundas fin de publicación, calificación, carga de documentos y fecha del remate.
- auctionDate debe ser YYYY-MM-DD. Fechas con hora deben ser ISO 8601 con offset -05:00 cuando sea posible.
- No inventes coordenadas.
- appraisalValue y auctionBaseValue son números en USD, sin separadores de miles.
- Incluye evidencia breve y página para address, appraisalValue, auctionBaseValue, signalingNumber, ownershipPercentage, auctionDate y legalFramework cuando estén presentes.
- La evidencia debe ser una cita corta del documento, nunca una conclusión no respaldada.

Versión del prompt: ${PROMPT_VERSION}.`;

type OpenAiResponse = {
  error?: { message?: string };
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string; refusal?: string }>;
  }>;
};

const responseText = (response: OpenAiResponse) => {
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) return content.text;
      if (content.refusal) throw new Error(`OpenAI refused extraction: ${content.refusal}`);
    }
  }
  throw new Error(response.error?.message || "OpenAI returned no extraction output.");
};

export const extractRemateDocument = async (pdf: Buffer, filename: string) => {
  let nativeText = "";
  try {
    const extracted = await extractText(new Uint8Array(pdf), { mergePages: true });
    nativeText = extracted.text.replace(/\s+/g, " ").trim();
  } catch (error) {
    console.warn(JSON.stringify({ action: "native_pdf_extraction", status: "failed", error: error instanceof Error ? error.message : String(error) }));
  }

  const model = process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_DEFAULT_MODEL || "gpt-5.4-mini";
  const apiKey = await getOpenAiApiKey();
  const content = nativeText.length >= 300
    ? [
      { type: "input_text", text: `${EXTRACTION_PROMPT}\n\nTexto extraído del PDF:\n${nativeText}` },
    ]
    : [
      {
        type: "input_file",
        filename,
        file_data: `data:application/pdf;base64,${pdf.toString("base64")}`,
      },
      { type: "input_text", text: EXTRACTION_PROMPT },
    ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "ecuador_real_estate_auction",
          strict: true,
          schema: remateExtractionSchema,
        },
      },
      max_output_tokens: 6000,
      store: false,
    }),
  });

  const body = await response.json() as OpenAiResponse;
  if (!response.ok) throw new Error(body.error?.message || `OpenAI extraction failed (${response.status}).`);
  const extraction = JSON.parse(responseText(body)) as DocumentExtraction;
  return { extraction, model, nativeTextLength: nativeText.length };
};
