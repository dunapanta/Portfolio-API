import * as AWS from "aws-sdk";
import { APIGatewayProxyEvent } from "aws-lambda";
import { formatJSONResponse } from "@libs/apiGateway";
import { dynamo } from "@libs/dynamo";
import * as fileType from "file-type";
import { nanoid } from "nanoid";
const s3 = new AWS.S3();
const allowedMimeType = ["image/png", "image/jpeg", "image/jpg"];
export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = JSON.parse(event.body);
    const {
      name,
      proyectLinks,
      priority,
      projectTechnologies,
      projectImage,
      projectImageMime,
    } = body;
    const tableName = process.env.portfolioTable;
    if (
      !name ||
      !proyectLinks ||
      !priority ||
      !projectTechnologies ||
      !projectImage ||
      !projectImageMime
    ) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message:
            "Missing required parameters (name, proyectLinks, priority, projectImage, projectImageMime or projectTechnologies)",
        },
      });
    }
    if (!allowedMimeType.includes(projectImageMime)) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Invalid mime type",
        },
      });
    }
    let imageData = projectImage;
    if (projectImage.substr(0, 7) === "base64,") {
      imageData = projectImage.substr(7, projectImage.length);
    }
    const buffer = Buffer.from(imageData, "base64");
    const fileInfo = await fileType.fileTypeFromBuffer(buffer);
    const detectedExtension = fileInfo?.ext;
    const detectedMime = fileInfo?.mime;
    console.log("Mime:", detectedMime);
    console.log("Extension:", detectedExtension);
    if (detectedMime !== projectImageMime) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message: "Mime type does not match the file",
        },
      });
    }
    const identifier = nanoid();
    //Store S3
    const imageKey = `${identifier}.${detectedExtension}`;
    console.log("Imagen:", imageKey);
    const s3Response = await s3
      .putObject({
        Bucket: process.env.imageUploadBucket,
        Body: buffer,
        Key: imageKey,
        ContentType: projectImageMime,
        ACL: "public-read",
      })
      .promise();
    //Save to DynamoDB
    const dataDynamo = {
      id: identifier,
      name,
      proyectLinks,
      priority,
      projectTechnologies,
      imageUrl: `${imageKey}`,
    };
    const dynamoResponse = await dynamo.write(dataDynamo, tableName);
    return formatJSONResponse({
      statusCode: 200,
      data: {
        message: "Project created successfully",
        s3Response,
        dynamoResponse,
      },
    });
  } catch (err) {
    console.log(err);
    return formatJSONResponse({
      statusCode: 500,
      data: {
        message: err.message,
      },
    });
  }
};