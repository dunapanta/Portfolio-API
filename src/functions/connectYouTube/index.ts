import { APIGatewayProxyEvent } from "aws-lambda";
import { serializeCookie } from "@libs/facebookOAuth";
import { createYouTubeState, getYouTubeLoginUrl } from "@libs/youtubeOAuth";

export const handler = async (_event: APIGatewayProxyEvent) => {
  try {
    const state = createYouTubeState();
    const stateCookie = serializeCookie({
      maxAge: 60 * 10,
      name: "s2p_youtube_oauth_state",
      value: state,
    });

    return {
      statusCode: 302,
      cookies: [stateCookie],
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Location": getYouTubeLoginUrl(state),
      },
      body: "",
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: error instanceof Error ? error.message : "Unable to start YouTube OAuth.",
      }),
    };
  }
};
