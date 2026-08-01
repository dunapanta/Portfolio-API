import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const ses = new SESClient({});

const ALLOWED_ORIGINS = new Set([
  "https://sacacarnet.com",
  "https://www.sacacarnet.com",
  "http://localhost:3000",
]);

const REASONS: Record<string, string> = {
  error: "Error en una pregunta",
  sugerencia: "Sugerencia para la app",
  problema: "Problema técnico",
  otro: "Otra consulta",
};

const response = (
  statusCode: number,
  data: Record<string, unknown>,
  origin?: string,
): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://sacacarnet.com",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  },
  body: JSON.stringify(data),
});

const clean = (value: unknown, maxLength: number) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const origin = event.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return response(403, { message: "Origen no permitido." }, origin);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(event.body ?? "{}") as Record<string, unknown>;
  } catch {
    return response(400, { message: "El cuerpo de la solicitud no es válido." }, origin);
  }

  // Honeypot: responde como si todo hubiera ido bien para no enseñar al bot.
  if (clean(payload.website, 200)) {
    return response(202, { message: "Mensaje recibido." }, origin);
  }

  const name = clean(payload.name, 80) || "Usuario de SacaCarnet";
  const email = clean(payload.email, 160).toLowerCase();
  const reason = clean(payload.reason, 30);
  const message = clean(payload.message, 4000);

  if (!/^\S+@\S+\.\S+$/.test(email) || message.length < 10 || !REASONS[reason]) {
    return response(400, { message: "Revisa el correo, el motivo y el mensaje." }, origin);
  }

  const source = process.env.SACACARNET_CONTACT_FROM_EMAIL;
  const destination = process.env.SACACARNET_CONTACT_TO_EMAIL;
  if (!source || !destination) {
    console.error("SacaCarnet contact email environment is not configured");
    return response(503, { message: "El servicio de contacto no está disponible." }, origin);
  }

  const sourceIp = event.requestContext.http.sourceIp || "desconocida";
  const text = [
    `Motivo: ${REASONS[reason]}`,
    `Nombre: ${name}`,
    `Correo: ${email}`,
    `IP: ${sourceIp}`,
    "",
    message,
  ].join("\n");

  try {
    await ses.send(
      new SendEmailCommand({
        Source: source,
        Destination: { ToAddresses: [destination] },
        ReplyToAddresses: [email],
        Message: {
          Subject: { Charset: "UTF-8", Data: `SacaCarnet · ${REASONS[reason]}` },
          Body: { Text: { Charset: "UTF-8", Data: text } },
        },
      }),
    );
    return response(202, { message: "Mensaje recibido." }, origin);
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown SES error";
    console.error("SacaCarnet contact send failed", detail);
    return response(502, { message: "No se pudo enviar el mensaje." }, origin);
  }
};
