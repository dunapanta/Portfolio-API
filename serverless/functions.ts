import type { AWS } from "@serverless/typescript";

const functions: AWS["functions"] = {
  sendProjects: {
    handler: "src/functions/sendProjects/index.handler",
    events: [
      {
        httpApi: {
          method: "post",
          path: "/projects",
        },
      },
    ],
  },
};

export default functions;
