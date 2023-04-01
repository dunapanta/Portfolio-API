import { APIGatewayProxyEvent } from "aws-lambda";
import { dynamo } from "@libs/dynamo";
import { formatJSONResponse } from "@libs/apiGateway";

export const handler = async (_: APIGatewayProxyEvent) => {
  try {
    const tableName = process.env.portfolioTable;

    const dynamoResponse = await dynamo.getAll(tableName);

    return formatJSONResponse({
      statusCode: 200,
      data: {
        message: "Retrieve projects successfully",
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
