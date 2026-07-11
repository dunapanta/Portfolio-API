import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import {
  createTweetMediaKey,
  createTweetMediaUploadUrl,
  inferTweetMediaKind,
} from "@libs/tweetMedia";

// X limits: images <= 5MB, GIF <= 15MB, video <= 512MB.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const fileName = String(body.fileName || "").trim();
    const contentType = String(body.contentType || "").trim();
    if (!fileName || !contentType) {
      throw new Error("fileName and contentType are required.");
    }

    const kind = inferTweetMediaKind(contentType);
    const sizeBytes = Number(body.sizeBytes);
    if (Number.isFinite(sizeBytes)) {
      const limit = kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (sizeBytes > limit) {
        throw new Error(
          `${kind === "video" ? "Video" : "Image"} exceeds the ${
            kind === "video" ? "512MB" : "5MB"
          } X limit.`
        );
      }
    }

    const key = createTweetMediaKey({ contentType, fileName });
    const uploadUrl = await createTweetMediaUploadUrl({ contentType, key });

    return formatJSONResponse({
      data: {
        media: { contentType, fileName, key, kind, sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined },
        message: "Upload URL created.",
        uploadUrl,
      },
    });
  } catch (error) {
    return formatJSONResponse({
      statusCode: 400,
      data: { message: error instanceof Error ? error.message : "Unable to create upload URL." },
    });
  }
};
