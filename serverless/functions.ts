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
  createTemplateReelRender: {
    handler: "src/functions/createTemplateReelRender/index.handler",
    timeout: 30,
    events: [
      {
        httpApi: {
          method: "post",
          path: "/swipe2play/reels/render-template",
        },
      },
    ],
  },
  getTemplateReelRender: {
    handler: "src/functions/getTemplateReelRender/index.handler",
    timeout: 30,
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/reels/{reelId}/render",
        },
      },
    ],
  },
  listReelJobs: {
    handler: "src/functions/listReelJobs/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
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
  publishReel: {
    handler: "src/functions/publishReel/index.handler",
    timeout: 30,
    events: [
      {
        httpApi: {
          method: "post",
          path: "/swipe2play/reels/{reelId}/publish",
        },
      },
    ],
  },
  refreshReelMetrics: {
    handler: "src/functions/refreshReelMetrics/index.handler",
    timeout: 30,
    events: [
      {
        httpApi: {
          method: "post",
          path: "/swipe2play/reels/{reelId}/metrics",
        },
      },
    ],
  },
  listGameContexts: {
    handler: "src/functions/listGameContexts/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/games",
        },
      },
    ],
  },
  upsertGameContext: {
    handler: "src/functions/upsertGameContext/index.handler",
    events: [
      {
        httpApi: {
          method: "post",
          path: "/swipe2play/games",
        },
      },
      {
        httpApi: {
          method: "patch",
          path: "/swipe2play/games/{gameId}",
        },
      },
    ],
  },
  gameMediaAssets: {
    handler: "src/functions/gameMediaAssets/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/games/{gameId}/media",
        },
      },
      {
        httpApi: {
          method: "post",
          path: "/swipe2play/games/{gameId}/media",
        },
      },
      {
        httpApi: {
          method: "patch",
          path: "/swipe2play/games/{gameId}/media/{mediaId}",
        },
      },
      {
        httpApi: {
          method: "delete",
          path: "/swipe2play/games/{gameId}/media/{mediaId}",
        },
      },
    ],
  },
  generateGameReelPhrase: {
    handler: "src/functions/generateGameReelPhrase/index.handler",
    timeout: 30,
    events: [
      {
        httpApi: {
          method: "post",
          path: "/swipe2play/games/{gameId}/reel-phrase",
        },
      },
    ],
  },
  elevenLabsStatus: {
    handler: "src/functions/elevenLabsStatus/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/voice/status",
        },
      },
    ],
  },
  createVoiceover: {
    handler: "src/functions/createVoiceover/index.handler",
    timeout: 30,
    events: [
      {
        httpApi: {
          method: "post",
          path: "/swipe2play/voiceovers",
        },
      },
    ],
  },
  openAiStatus: {
    handler: "src/functions/openAiStatus/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/openai/status",
        },
      },
    ],
  },
  connectFacebook: {
    handler: "src/functions/connectFacebook/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/facebook/connect",
        },
      },
    ],
  },
  facebookCallback: {
    handler: "src/functions/facebookCallback/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/facebook/callback",
        },
      },
    ],
  },
  facebookStatus: {
    handler: "src/functions/facebookStatus/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/facebook/status",
        },
      },
    ],
  },
  connectYouTube: {
    handler: "src/functions/connectYouTube/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/youtube/connect",
        },
      },
    ],
  },
  youtubeCallback: {
    handler: "src/functions/youtubeCallback/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/youtube/callback",
        },
      },
    ],
  },
  youtubeStatus: {
    handler: "src/functions/youtubeStatus/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/youtube/status",
        },
      },
    ],
  },
};

export default functions;
