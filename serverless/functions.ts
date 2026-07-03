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
  sendEmail: {
    handler: "src/functions/sendEmail/index.handler",
    events: [
      {
        httpApi: {
          method: "post",
          path: "/email",
        },
      },
    ],
     //@ts-expect-error
     iamRoleStatements: [
      {
        Effect: "Allow",
        Action: ["ses:SendEmail"],
        Resource: "*",
      },
    ],
  },
  createReelJob: {
    handler: "src/functions/createReelJob/index.handler",
    events: [
      {
        httpApi: {
          method: "post",
          path: "/swipe2play/reels",
        },
      },
    ],
  },
  getReelJob: {
    handler: "src/functions/getReelJob/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/reels/{reelId}",
        },
      },
    ],
  },
  updateReelJob: {
    handler: "src/functions/updateReelJob/index.handler",
    events: [
      {
        httpApi: {
          method: "patch",
          path: "/swipe2play/reels/{reelId}",
        },
      },
    ],
  },
  createReelUpload: {
    handler: "src/functions/createReelUpload/index.handler",
    events: [
      {
        httpApi: {
          method: "post",
          path: "/swipe2play/reels/{reelId}/uploads",
        },
      },
    ],
  },
};

export default functions;
