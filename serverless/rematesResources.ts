import type { AWS } from "@serverless/typescript";

const rematesResources: AWS["resources"]["Resources"] = {
  rematesTable: {
    Type: "AWS::DynamoDB::Table",
    Properties: {
      TableName: "${self:custom.rematesTableName}",
      AttributeDefinitions: [
        { AttributeName: "id", AttributeType: "S" },
        { AttributeName: "entity", AttributeType: "S" },
        { AttributeName: "capturedAt", AttributeType: "S" },
      ],
      KeySchema: [{ AttributeName: "id", KeyType: "HASH" }],
      GlobalSecondaryIndexes: [
        {
          IndexName: "GSI-remates-by-entity",
          KeySchema: [
            { AttributeName: "entity", KeyType: "HASH" },
            { AttributeName: "capturedAt", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      BillingMode: "PAY_PER_REQUEST",
    },
  },
  rematesDocumentsBucket: {
    Type: "AWS::S3::Bucket",
    Properties: {
      BucketName: "${self:custom.rematesDocumentsBucketName}",
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
      VersioningConfiguration: { Status: "Enabled" },
      LifecycleConfiguration: {
        Rules: [
          {
            Id: "AbortIncompleteUploads",
            Status: "Enabled",
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
          },
        ],
      },
    },
  },
  rematesExtractionDeadLetterQueue: {
    Type: "AWS::SQS::Queue",
    Properties: {
      QueueName: "${self:custom.rematesExtractionDeadLetterQueueName}",
      MessageRetentionPeriod: 1209600,
    },
  },
  rematesExtractionQueue: {
    Type: "AWS::SQS::Queue",
    Properties: {
      QueueName: "${self:custom.rematesExtractionQueueName}",
      VisibilityTimeout: 360,
      MessageRetentionPeriod: 345600,
      RedrivePolicy: {
        deadLetterTargetArn: { "Fn::GetAtt": ["rematesExtractionDeadLetterQueue", "Arn"] },
        maxReceiveCount: 3,
      },
    },
  },
};

export default rematesResources;
