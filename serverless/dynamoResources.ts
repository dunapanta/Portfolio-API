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
};

export default dynamoResources;
