import { APIGatewayProxyEvent } from "aws-lambda";
import { serializeCookie } from "@libs/facebookOAuth";
import { createXCodeVerifier, createXState, getXLoginUrl } from "@libs/xOAuth";

export const handler = async (_event: APIGatewayProxyEvent) => {
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

    return {
      statusCode: 302,
      cookies: [stateCookie, verifierCookie],
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
