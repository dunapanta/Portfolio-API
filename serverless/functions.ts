import type { AWS } from "@serverless/typescript";

const functions: AWS["functions"] = {
  layerDWorker: {
    name: "${self:custom.magicLayerWorkerFunctionName}",
    image: {
      uri: "${self:custom.magicLayerWorkerImageUri}",
    },
    memorySize: 10240,
    timeout: 900,
    ephemeralStorageSize: 10240,
    reservedConcurrency: 1,
    environment: {
      ASSETS_BUCKET: "${self:custom.gameMediaBucket}",
      JOBS_TABLE: "${self:custom.magicLayerJobsTableName}",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1",
    },
  },
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
  sacacarnetContact: {
    handler: "src/functions/sacacarnetContact/index.handler",
    events: [
      {
        httpApi: {
          method: "post",
          path: "/sacacarnet/contact",
        },
      },
    ],
    // @ts-expect-error Provided by serverless-iam-roles-per-function.
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
  scheduleReelPublish: {
    handler: "src/functions/scheduleReelPublish/index.handler",
    timeout: 30,
    events: [
      {
        httpApi: {
          method: "post",
          path: "/swipe2play/reels/{reelId}/schedule",
        },
      },
    ],
  },
  autoPublishDueReels: {
    handler: "src/functions/autoPublishDueReels/index.handler",
    timeout: 600,
    events: [
      {
        schedule: "rate(10 minutes)",
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
    timeout: 20,
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
  getGameAssetJob: {
    handler: "src/functions/getGameAssetJob/index.handler",
    events: [
      {
        httpApi: {
          method: "get",
          path: "/sprite-studio/asset/{jobId}",
        },
      },
    ],
  },
  generateGameAssetWorker: {
    handler: "src/functions/generateGameAssetWorker/index.handler",
    timeout: 180,
    memorySize: 1024,
  },
  spriteAssets: {
    handler: "src/functions/spriteAssets/index.handler",
    events: [
      { httpApi: { method: "get", path: "/sprite-studio/assets" } },
      { httpApi: { method: "post", path: "/sprite-studio/assets" } },
    ],
  },
  getSpriteAsset: {
    handler: "src/functions/getSpriteAsset/index.handler",
    events: [
      { httpApi: { method: "get", path: "/sprite-studio/assets/{assetId}" } },
    ],
  },
  createMagicLayerJob: {
    handler: "src/functions/createMagicLayerJob/index.handler",
    events: [{ httpApi: { method: "post", path: "/magic-layers/jobs" } }],
  },
  verifyMagicLayerAccess: {
    handler: "src/functions/verifyMagicLayerAccess/index.handler",
    events: [{ httpApi: { method: "post", path: "/magic-layers/access" } }],
  },
  startMagicLayerJob: {
    handler: "src/functions/startMagicLayerJob/index.handler",
    timeout: 30,
    events: [{ httpApi: { method: "post", path: "/magic-layers/jobs/{jobId}/start" } }],
  },
  getMagicLayerJob: {
    handler: "src/functions/getMagicLayerJob/index.handler",
    timeout: 30,
    events: [{ httpApi: { method: "get", path: "/magic-layers/jobs/{jobId}" } }],
  },
  verifyCreativeStudioAccess: {
    handler: "src/functions/verifyCreativeStudioAccess/index.handler",
    events: [{ httpApi: { method: "post", path: "/carousel-studio/access" } }],
  },
  creativeStudioUpload: {
    handler: "src/functions/creativeStudioUpload/index.handler",
    events: [{ httpApi: { method: "post", path: "/carousel-studio/uploads" } }],
  },
  creativeStudioProjects: {
    handler: "src/functions/creativeStudioProjects/index.handler",
    timeout: 30,
    events: [
      { httpApi: { method: "get", path: "/carousel-studio/projects" } },
      { httpApi: { method: "post", path: "/carousel-studio/projects" } },
      { httpApi: { method: "get", path: "/carousel-studio/projects/{projectId}" } },
      { httpApi: { method: "patch", path: "/carousel-studio/projects/{projectId}" } },
      { httpApi: { method: "delete", path: "/carousel-studio/projects/{projectId}" } },
    ],
  },
  generateCreativeStudioPlan: {
    handler: "src/functions/generateCreativeStudioPlan/index.handler",
    timeout: 90,
    memorySize: 1024,
    events: [{ httpApi: { method: "post", path: "/carousel-studio/generate" } }],
  },
  verifyAppOpportunitiesAccess: {
    handler: "src/functions/verifyAppOpportunitiesAccess/index.handler",
    events: [{ httpApi: { method: "post", path: "/app-opportunities/access" } }],
  },
  appOpportunities: {
    handler: "src/functions/appOpportunities/index.handler",
    timeout: 29,
    memorySize: 1024,
    events: [
      { httpApi: { method: "get", path: "/app-opportunities" } },
      { httpApi: { method: "post", path: "/app-opportunities/snapshots" } },
    ],
  },
  enrichAppOpportunities: {
    handler: "src/functions/enrichAppOpportunities/index.handler",
    timeout: 180,
    memorySize: 1024,
  },
  rematesApi: {
    handler: "src/functions/rematesApi/index.handler",
    timeout: 29,
    memorySize: 1024,
    events: [
      { httpApi: { method: "get", path: "/tools/remates" } },
      { httpApi: { method: "get", path: "/tools/remates/filters" } },
      { httpApi: { method: "get", path: "/tools/remates/stats" } },
      { httpApi: { method: "get", path: "/tools/remates/scrape-runs" } },
      { httpApi: { method: "get", path: "/tools/remates/{id}" } },
      { httpApi: { method: "post", path: "/tools/remates/admin/scrape" } },
    ],
  },
  syncRemates: {
    name: "${self:custom.rematesSyncFunctionName}",
    handler: "src/functions/syncRemates/index.handler",
    timeout: 900,
    memorySize: 2048,
    ephemeralStorageSize: 2048,
    events: [
      { schedule: { rate: ["${env:REMATES_BIESS_WEEKLY_SCHEDULE, 'cron(0 11 ? * MON *)'}"], input: { source: "BIESS", triggeredBy: "schedule" } } },
      { schedule: { rate: ["${env:REMATES_SRI_WEEKLY_SCHEDULE, 'cron(0 12 ? * MON *)'}"], input: { source: "SRI", triggeredBy: "schedule" } } },
      { schedule: { rate: ["${env:REMATES_CJ_WEEKLY_SCHEDULE, 'cron(0 13 ? * MON *)'}"], input: { source: "CJ", triggeredBy: "schedule" } } },
      { schedule: { rate: ["${env:REMATES_CFN_WEEKLY_SCHEDULE, 'cron(0 14 ? * MON *)'}"], input: { source: "CFN", triggeredBy: "schedule" } } },
    ],
  },
  extractRemateDocument: {
    handler: "src/functions/extractRemateDocument/index.handler",
    timeout: 300,
    memorySize: 2048,
    ephemeralStorageSize: 2048,
    reservedConcurrency: 2,
    events: [
      {
        sqs: {
          arn: "arn:aws:sqs:${self:provider.region}:${aws:accountId}:${self:custom.rematesExtractionQueueName}",
          batchSize: 1,
          maximumBatchingWindow: 0,
        },
      },
    ],
  },
};

export default functions;
