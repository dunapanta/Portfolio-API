import { formatJSONResponse } from "@libs/apiGateway";
import { APIGatewayProxyEvent } from "aws-lambda";

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = JSON.parse(event.body);
    const { name, proyectLinks, priority, projectTechnologies, projectImage } =
      body;

    if (
      !name ||
      !proyectLinks ||
      !priority ||
      !projectTechnologies ||
      !projectImage
      //!projectImage.mime
    ) {
      return formatJSONResponse({
        statusCode: 400,
        data: {
          message:
            "Missing required parameters (name, proyectLinks, priority, projectImage or projectTechnologies)",
        },
      });
    }

    return formatJSONResponse({
      statusCode: 200,
      data: {
        message: "Project created successfully",
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
