import { APIGatewayProxyEvent } from "aws-lambda";
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-ses";
import { formatJSONResponse } from "@libs/apiGateway";

const sesClient = new SESClient({});

export const handler = async (event: APIGatewayProxyEvent) => {
  try {
    const body = JSON.parse(event.body);
    const { name, email, message } = body;
    if (!name || !email || !message) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          message: "Missing required parameters (name, email or message)",
        }),
      };
    }
    const messageId = await sendEmail({ name, email, message });
    return formatJSONResponse({
      statusCode: 200,
      data: {
        message: "Email sent successfully",
        messageId,
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

const sendEmail = async ({
  name,
  email,
  message,
}: {
  name: string;
  email: string;
  message: string;
}) => {
  const params: SendEmailCommandInput = {
    Source: email,
    Destination: {
      ToAddresses: [""],
    },
    Message: {
      Body: {
        Text: {
          Charset: "UTF-8",
          Data: `Name: ${name} \n Email: ${email} \n Message: ${message}`,
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: "Portfolio Contact Message",
      },
    },
  };
  const command = new SendEmailCommand(params);

  const res = await sesClient.send(command);

  return res.MessageId;
};
