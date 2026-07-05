import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetCommand,
  GetCommandInput,
  PutCommand,
  PutCommandInput,
  DeleteCommand,
  DeleteCommandInput,
  UpdateCommand,
  UpdateCommandInput,
  QueryCommandInput,
  QueryCommand,
  ScanCommand,
  ScanCommandInput,
} from "@aws-sdk/lib-dynamodb";

//default region where lambda is deploying
const dynamoClient = new DynamoDBClient({});
export const dynamo = {
  write: async (data: Record<string, any>, tableName: string) => {
    const params: PutCommandInput = {
      TableName: tableName,
      Item: data,
    };
    const command = new PutCommand(params);

    //const res = await dynamoClient.send(command);
    //console.log("DynamoDb res:", res);
    await dynamoClient.send(command);

    return data;
  },
  delete: async (id: string, tableName: string) => {
    const params: DeleteCommandInput = {
      TableName: tableName,
      Key: {
        id,
      },
    };
    const command = new DeleteCommand(params);

    await dynamoClient.send(command);
  },
  get: async (id: string, tableName: string) => {
    const params: GetCommandInput = {
      TableName: tableName,
      Key: {
        id,
      },
    };
    const command = new GetCommand(params);
    const response = await dynamoClient.send(command);

    return response.Item;
  },
  getAll: async (tableName: string) => {
    const params: ScanCommandInput = {
      TableName: tableName,
    };
    const command = new ScanCommand(params);
    const response = await dynamoClient.send(command);

    return response.Items;
  },
  update: async ({
    id,
    tableName,
    data,
  }: {
    id: string;
    tableName: string;
    data: Record<string, any>;
  }) => {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined);
    if (!entries.length) return dynamo.get(id, tableName);

    const ExpressionAttributeNames: Record<string, string> = {};
    const ExpressionAttributeValues: Record<string, any> = {};
    const updateExpressions = entries.map(([key, value]) => {
      const nameKey = `#${key}`;
      const valueKey = `:${key}`;
      ExpressionAttributeNames[nameKey] = key;
      ExpressionAttributeValues[valueKey] = value;
      return `${nameKey} = ${valueKey}`;
    });

    const params: UpdateCommandInput = {
      TableName: tableName,
      Key: {
        id,
      },
      UpdateExpression: `SET ${updateExpressions.join(", ")}`,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ReturnValues: "ALL_NEW",
    };
    const command = new UpdateCommand(params);
    const response = await dynamoClient.send(command);

    return response.Attributes;
  },
  query: async ({
    tableName,
    index,

    pkValue,
    pkKey = "pk",

    skValue,
    skKey = "sk",

    sortAscending = true,
  }: {
    tableName: string;
    index: string;

    pkValue: string;
    pkKey?: string;

    skValue?: string;
    skKey?: string;

    sortAscending?: boolean;
  }) => {
    const skExpression = skValue ? ` AND ${skKey} = :rangeValue` : "";

    const params: QueryCommandInput = {
      TableName: tableName,
      IndexName: index,
      KeyConditionExpression: `${pkKey} = :hashValue${skExpression}`,
      ScanIndexForward: sortAscending,
      ExpressionAttributeValues: {
        ":hashValue": pkValue,
      },
    };

    if (skValue) {
      params.ExpressionAttributeValues[":rangeValue"] = skValue;
    }

    const command = new QueryCommand(params);

    const response = await dynamoClient.send(command);

    return response.Items;
  },
  queryPage: async ({
    tableName,
    index,

    pkValue,
    pkKey = "pk",

    limit,
    nextToken,
    sortAscending = true,
  }: {
    tableName: string;
    index: string;

    pkValue: string;
    pkKey?: string;

    limit?: number;
    nextToken?: string;
    sortAscending?: boolean;
  }) => {
    const params: QueryCommandInput = {
      TableName: tableName,
      IndexName: index,
      KeyConditionExpression: `${pkKey} = :hashValue`,
      ScanIndexForward: sortAscending,
      ExpressionAttributeValues: {
        ":hashValue": pkValue,
      },
      ExclusiveStartKey: nextToken
        ? JSON.parse(Buffer.from(nextToken, "base64").toString("utf8"))
        : undefined,
      Limit: limit,
    };

    const command = new QueryCommand(params);
    const response = await dynamoClient.send(command);

    return {
      items: response.Items ?? [],
      nextToken: response.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString("base64")
        : undefined,
    };
  },
};
