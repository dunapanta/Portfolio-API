import type { AWS } from "@serverless/typescript";

const functions: AWS["functions"] = {
  createProject: {
    handler: "src/functions/createProject/index.handler",
    events: [
      {
        httpApi: {
          method: "post",
          path: "/project",
        },
      },
    ],
  },
  sendProjects: {
    handler: "src/functions/sendProjects/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/projects",
        },
      },
    ],
  },
};

export default functions;
