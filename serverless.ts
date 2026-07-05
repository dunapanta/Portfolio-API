import type { AWS } from "@serverless/typescript";

import functions from "./serverless/functions";
import dynamoResources from "./serverless/dynamoResources";
import AssetsBucketAndCloudfront from "./serverless/AssetsBucketAndCloudfront";

const serverlessConfiguration: AWS = {
  service: "duportfolioapi",
  frameworkVersion: "3",
  plugins: ["serverless-esbuild", "serverless-iam-roles-per-function"],
  provider: {
    name: "aws",
    runtime: "nodejs22.x" as never,
    region: "us-east-1",
    profile: "serverlessUser",
    iamRoleStatements: [
      {
        Effect: "Allow",
        Action: "dynamodb:*",
        Resource: [
          "arn:aws:dynamodb:${self:provider.region}:${aws:accountId}:table/${self:custom.portfolioTableName}",
          "arn:aws:dynamodb:${self:provider.region}:${aws:accountId}:table/${self:custom.reelJobsTableName}",
          "arn:aws:dynamodb:${self:provider.region}:${aws:accountId}:table/${self:custom.reelJobsTableName}/index/GSI-reel-jobs-by-template",
          "arn:aws:dynamodb:${self:provider.region}:${aws:accountId}:table/${self:custom.reelJobsTableName}/index/GSI-reel-jobs-by-status",
          "arn:aws:dynamodb:${self:provider.region}:${aws:accountId}:table/${self:custom.gameContextsTableName}",
          "arn:aws:dynamodb:${self:provider.region}:${aws:accountId}:table/${self:custom.socialConnectionsTableName}",
        ],
      },
      //S3
      {
        Effect: "Allow",
        Action: "s3:*",
        Resource: [
          "arn:aws:s3:::${self:custom.imageUploadBucket}",
          "arn:aws:s3:::${self:custom.imageUploadBucket}/*",
          "arn:aws:s3:::${self:custom.reelAssetsBucket}",
          "arn:aws:s3:::${self:custom.reelAssetsBucket}/*",
        ],
      },
      {
        Effect: "Allow",
        Action: ["ssm:GetParameter"],
        Resource: [
          "arn:aws:ssm:${self:provider.region}:${aws:accountId}:parameter${self:custom.elevenLabsApiKeyParameterName}",
        ],
      },
    ],
    apiGateway: {
      minimumCompressionSize: 1024,
      shouldStartNameWithService: true,
    },
    httpApi: {
      cors: {
        allowedHeaders: ["Content-Type", "Authorization"],
        allowedMethods: ["GET", "POST", "PATCH", "OPTIONS"],
        allowedOrigins: [
          "https://www.dunapant.dev",
          "https://dunapant.dev",
          "http://localhost:3000",
          "http://localhost:3002",
        ],
        maxAge: 86400,
      },
    },
    environment: {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
      NODE_OPTIONS: "--enable-source-maps --stack-trace-limit=1000",

      portfolioTable: "${self:custom.portfolioTableName}",
      imageUploadBucket: "${self:custom.imageUploadBucket}",
      reelJobsTable: "${self:custom.reelJobsTableName}",
      reelAssetsBucket: "${self:custom.reelAssetsBucket}",
      reelAssetTtlDays: "${self:custom.reelAssetTtlDays}",
      gameContextsTable: "${self:custom.gameContextsTableName}",
      socialConnectionsTable: "${self:custom.socialConnectionsTableName}",
      META_APP_ID: "${env:META_APP_ID, ''}",
      META_APP_SECRET: "${env:META_APP_SECRET, ''}",
      META_GRAPH_VERSION: "${env:META_GRAPH_VERSION, 'v25.0'}",
      META_OAUTH_REDIRECT_URI: "${env:META_OAUTH_REDIRECT_URI, ''}",
      META_PAGE_ID: "${env:META_PAGE_ID, ''}",
      SWIPE2PLAY_REEL_MAKER_URL: "${env:SWIPE2PLAY_REEL_MAKER_URL, 'https://www.dunapant.dev/10000-offline-games/reel-maker'}",
      YOUTUBE_CLIENT_ID: "${env:YOUTUBE_CLIENT_ID, ''}",
      YOUTUBE_CLIENT_SECRET: "${env:YOUTUBE_CLIENT_SECRET, ''}",
      YOUTUBE_OAUTH_REDIRECT_URI: "${env:YOUTUBE_OAUTH_REDIRECT_URI, ''}",
      ELEVENLABS_API_KEY_PARAM: "${self:custom.elevenLabsApiKeyParameterName}",
      ELEVENLABS_DEFAULT_MODEL_ID: "${env:ELEVENLABS_DEFAULT_MODEL_ID, 'eleven_multilingual_v2'}",
      ELEVENLABS_DEFAULT_OUTPUT_FORMAT: "${env:ELEVENLABS_DEFAULT_OUTPUT_FORMAT, 'mp3_44100_128'}",
      ELEVENLABS_DEFAULT_VOICE_ID: "${env:ELEVENLABS_DEFAULT_VOICE_ID, '21m00Tcm4TlvDq8ikWAM'}",
    },
  },
  // import the function via paths
  functions,
  resources: {
    Resources: {
      ...dynamoResources,
      ...AssetsBucketAndCloudfront,
      
    },
  },
  package: { individually: true },
  custom: {
    portfolioTableName: "${sls:stage}-portfolio-table",
    imageUploadBucket: "${sls:stage}-image-upload-bucket-du-portfolio",
    reelJobsTableName: "${sls:stage}-swipe2play-reel-jobs",
    reelAssetsBucket: "${sls:stage}-swipe2play-reel-assets-du-portfolio",
    reelAssetTtlDays: 7,
    gameContextsTableName: "${sls:stage}-swipe2play-game-contexts",
    elevenLabsApiKeyParameterName: "/duportfolioapi/${sls:stage}/elevenlabs/api-key",
    socialConnectionsTableName: "${sls:stage}-swipe2play-social-connections",
    esbuild: {
      bundle: true,
      minify: false,
      sourcemap: true,
      exclude: ["aws-sdk"],
      target: "node22",
      define: { "require.resolve": undefined },
      platform: "node",
      concurrency: 10,
    },
  },
};

module.exports = serverlessConfiguration;
