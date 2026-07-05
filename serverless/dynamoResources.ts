import type { AWS } from "@serverless/typescript";

const dynamoResources: AWS["resources"]["Resources"] = {
  portfolioTable: {
    Type: "AWS::DynamoDB::Table",
    Properties: {
      TableName: "${self:custom.portfolioTableName}",
      AttributeDefinitions: [
        {
          AttributeName: "id",
          AttributeType: "S",
        },
        /* {
          AttributeName: "pk",
          AttributeType: "S",
        },
        {
          AttributeName: "sk",
          AttributeType: "S",
        }, */
      ],
      KeySchema: [
        {
          AttributeName: "id",
          KeyType: "HASH",
        },
      ],
      /* GlobalSecondaryIndexes: [
        {
          IndexName: "index1",
          KeySchema: [
            {
              AttributeName: "pk",
              KeyType: "HASH",
            },
            {
              AttributeName: "sk",
              KeyType: "RANGE",
            },
          ],
          Projection: {
            ProjectionType: "ALL",
          },
        },
      ], */
      BillingMode: "PAY_PER_REQUEST",
    },
  },
  reelJobsTable: {
    Type: "AWS::DynamoDB::Table",
    Properties: {
      TableName: "${self:custom.reelJobsTableName}",
      AttributeDefinitions: [
        {
          AttributeName: "id",
          AttributeType: "S",
        },
        {
          AttributeName: "templateId",
          AttributeType: "S",
        },
        {
          AttributeName: "status",
          AttributeType: "S",
        },
        {
          AttributeName: "createdAt",
          AttributeType: "S",
        },
      ],
      KeySchema: [
        {
          AttributeName: "id",
          KeyType: "HASH",
        },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI-reel-jobs-by-template",
          KeySchema: [
            {
              AttributeName: "templateId",
              KeyType: "HASH",
            },
            {
              AttributeName: "createdAt",
              KeyType: "RANGE",
            },
          ],
          Projection: {
            ProjectionType: "ALL",
          },
        },
        {
          IndexName: "GSI-reel-jobs-by-status",
          KeySchema: [
            {
              AttributeName: "status",
              KeyType: "HASH",
            },
            {
              AttributeName: "createdAt",
              KeyType: "RANGE",
            },
          ],
          Projection: {
            ProjectionType: "ALL",
          },
        },
      ],
      TimeToLiveSpecification: {
        AttributeName: "expiresAt",
        Enabled: true,
      },
      BillingMode: "PAY_PER_REQUEST",
    },
  },
  gameContextsTable: {
    Type: "AWS::DynamoDB::Table",
    Properties: {
      TableName: "${self:custom.gameContextsTableName}",
      AttributeDefinitions: [
        {
          AttributeName: "id",
          AttributeType: "S",
        },
      ],
      KeySchema: [
        {
          AttributeName: "id",
          KeyType: "HASH",
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    },
  },
  gameMediaAssetsTable: {
    Type: "AWS::DynamoDB::Table",
    Properties: {
      TableName: "${self:custom.gameMediaAssetsTableName}",
      AttributeDefinitions: [
        {
          AttributeName: "id",
          AttributeType: "S",
        },
        {
          AttributeName: "gameId",
          AttributeType: "S",
        },
        {
          AttributeName: "createdAt",
          AttributeType: "S",
        },
      ],
      KeySchema: [
        {
          AttributeName: "id",
          KeyType: "HASH",
        },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI-game-media-by-game",
          KeySchema: [
            {
              AttributeName: "gameId",
              KeyType: "HASH",
            },
            {
              AttributeName: "createdAt",
              KeyType: "RANGE",
            },
          ],
          Projection: {
            ProjectionType: "ALL",
          },
        },
      ],
      BillingMode: "PAY_PER_REQUEST",
    },
  },
  socialConnectionsTable: {
    Type: "AWS::DynamoDB::Table",
    Properties: {
      TableName: "${self:custom.socialConnectionsTableName}",
      AttributeDefinitions: [
        {
          AttributeName: "id",
          AttributeType: "S",
        },
      ],
      KeySchema: [
        {
          AttributeName: "id",
          KeyType: "HASH",
        },
      ],
      TimeToLiveSpecification: {
        AttributeName: "expiresAt",
        Enabled: true,
      },
      BillingMode: "PAY_PER_REQUEST",
    },
  },
};

export default dynamoResources;
