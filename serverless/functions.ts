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
  connectX: {
    handler: "src/functions/connectX/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/x/connect",
        },
      },
    ],
  },
  xCallback: {
    handler: "src/functions/xCallback/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/x/callback",
        },
      },
    ],
  },
  xStatus: {
    handler: "src/functions/xStatus/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/swipe2play/x/status",
        },
      },
    ],
  },

  // ---------------------------------------------------------------------------
  // Tweet Studio: schedule + auto-publish tweets from a daily context log.
  // ---------------------------------------------------------------------------
  tweetStudioStatus: {
    handler: "src/functions/tweetStudioStatus/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/tweet-studio/status",
        },
      },
    ],
  },
  listTweetActivity: {
    handler: "src/functions/listTweetActivity/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/tweet-studio/activity",
        },
      },
    ],
  },
  createTweetActivity: {
    handler: "src/functions/createTweetActivity/index.handler",
    events: [
      {
        httpApi: {
          method: "post",
          path: "/tweet-studio/activity",
        },
      },
    ],
  },
  deleteTweetActivity: {
    handler: "src/functions/deleteTweetActivity/index.handler",
    events: [
      {
        httpApi: {
          method: "delete",
          path: "/tweet-studio/activity/{activityId}",
        },
      },
    ],
  },
  createTweetMediaUpload: {
    handler: "src/functions/createTweetMediaUpload/index.handler",
    events: [
      {
        httpApi: {
          method: "post",
          path: "/tweet-studio/media",
        },
      },
    ],
  },
  generateTweetDrafts: {
    handler: "src/functions/generateTweetDrafts/index.handler",
    timeout: 30,
    events: [
      {
        httpApi: {
          method: "post",
          path: "/tweet-studio/generate",
        },
      },
    ],
  },
  listScheduledTweets: {
    handler: "src/functions/listScheduledTweets/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/tweet-studio/tweets",
        },
      },
    ],
  },
  createScheduledTweet: {
    handler: "src/functions/createScheduledTweet/index.handler",
    events: [
      {
        httpApi: {
          method: "post",
          path: "/tweet-studio/tweets",
        },
      },
    ],
  },
  updateScheduledTweet: {
    handler: "src/functions/updateScheduledTweet/index.handler",
    events: [
      {
        httpApi: {
          method: "patch",
          path: "/tweet-studio/tweets/{tweetId}",
        },
      },
    ],
  },
  deleteScheduledTweet: {
    handler: "src/functions/deleteScheduledTweet/index.handler",
    events: [
      {
        httpApi: {
          method: "delete",
          path: "/tweet-studio/tweets/{tweetId}",
        },
      },
    ],
  },
  publishScheduledTweet: {
    handler: "src/functions/publishScheduledTweet/index.handler",
    timeout: 120,
    events: [
      {
        httpApi: {
          method: "post",
          path: "/tweet-studio/tweets/{tweetId}/publish",
        },
      },
    ],
  },
  autoPublishDueTweets: {
    handler: "src/functions/autoPublishDueTweets/index.handler",
    timeout: 300,
    events: [
      {
        schedule: "rate(10 minutes)",
      },
    ],
  },
  planDailyTweets: {
    handler: "src/functions/planDailyTweets/index.handler",
    timeout: 120,
    events: [
      {
        // 11:00 UTC ~ early morning in America/Guayaquil: fill the day's queue.
        schedule: "cron(0 11 * * ? *)",
      },
    ],
  },
  generateSpriteCharacter: {
    handler: "src/functions/generateSpriteCharacter/index.handler",
    timeout: 60,
    events: [
      {
        httpApi: {
          method: "post",
          path: "/sprite-studio/character",
        },
      },
    ],
  },
  generateGameAsset: {
    handler: "src/functions/generateGameAsset/index.handler",
    timeout: 120,
    memorySize: 1024,
    events: [
      {
        httpApi: {
          method: "post",
          path: "/sprite-studio/asset",
        },
      },
    ],
  },
};

export default functions;
