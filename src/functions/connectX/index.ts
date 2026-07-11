import { APIGatewayProxyEvent } from "aws-lambda";
import { serializeCookie } from "@libs/facebookOAuth";
import { createXCodeVerifier, createXState, getXLoginUrl } from "@libs/xOAuth";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const state = createXState();
    const codeVerifier = createXCodeVerifier();
    const stateCookie = serializeCookie({
      maxAge: 60 * 10,
      name: "s2p_x_oauth_state",
      value: state,
    });
    const verifierCookie = serializeCookie({
      maxAge: 60 * 10,
      name: "s2p_x_code_verifier",
      value: codeVerifier,
    });
    // Remember where to land after the callback (reel-maker vs tweet-studio).
    const returnTo =
      event.queryStringParameters?.returnTo === "tweet-studio"
        ? "tweet-studio"
        : "reel-maker";
    const returnToCookie = serializeCookie({
      maxAge: 60 * 10,
      name: "s2p_x_return_to",
      value: returnTo,
    });

    return {
      statusCode: 302,
      cookies: [stateCookie, verifierCookie, returnToCookie],
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Location": getXLoginUrl({ codeVerifier, state }),
      },
      body: "",
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: error instanceof Error ? error.message : "Unable to start X OAuth.",
      }),
    };
  }
};
