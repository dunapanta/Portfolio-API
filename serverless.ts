import type { AWS } from "@serverless/typescript";

import functions from "./serverless/functions";
import dynamoResources from "./serverless/dynamoResources";
import AssetsBucketAndCloudfront from "./serverless/AssetsBucketAndCloudfront";

const serverlessConfiguration: AWS = {
  service: "duportfolioapi",
  frameworkVersion: "3",
  plugins: ["serverless-esbuild"],
  provider: {
    name: "aws",
    runtime: "nodejs14.x",
    region: "us-east-1",
    profile: "serverlessUser",
    iamRoleStatements: [
      {
        Effect: "Allow",
        Action: "dynamodb:*",
        Resource: [
          "arn:aws:dynamodb:${self:provider.region}:${aws:accountId}:table/${self:custom.portfolioTableName}",
        ],
      },
      //S3
      {
        Effect: "Allow",
        Action: "s3:*",
        Resource: [
          "arn:aws:s3:::${self:custom.imageUploadBucket}",
          "arn:aws:s3:::${self:custom.imageUploadBucket}/*",
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
    esbuild: {
      bundle: true,
      minify: false,
      sourcemap: true,
      exclude: ["aws-sdk"],
      target: "node14",
      define: { "require.resolve": undefined },
      platform: "node",
      concurrency: 10,
    },
  },
};

module.exports = serverlessConfiguration;
