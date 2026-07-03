import { APIGatewayProxyEvent } from "aws-lambda";
import {
  createFacebookState,
  getFacebookLoginUrl,
  serializeCookie,
} from "@libs/facebookOAuth";

export const handler = async (_event: APIGatewayProxyEvent) => {
  try {
    const state = createFacebookState();
    const stateCookie = serializeCookie({
      maxAge: 60 * 10,
      name: "s2p_fb_oauth_state",
      value: state,
    });

    return {
      statusCode: 302,
      cookies: [stateCookie],
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Location": getFacebookLoginUrl(state),
      },
      body: "",
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: error instanceof Error ? error.message : "Unable to start Facebook OAuth.",
      }),
    };
  }
};
