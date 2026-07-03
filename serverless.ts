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
    ],
    apiGateway: {
      minimumCompressionSize: 1024,
      shouldStartNameWithService: true,
    },
    environment: {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
      NODE_OPTIONS: "--enable-source-maps --stack-trace-limit=1000",

      portfolioTable: "${self:custom.portfolioTableName}",
      imageUploadBucket: "${self:custom.imageUploadBucket}",
      reelJobsTable: "${self:custom.reelJobsTableName}",
      reelAssetsBucket: "${self:custom.reelAssetsBucket}",
      reelAssetTtlDays: "${self:custom.reelAssetTtlDays}",
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
