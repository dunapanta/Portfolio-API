import { LambdaClient, GetFunctionConfigurationCommand } from "@aws-sdk/client-lambda";
import { SSMClient, GetParameterCommand, PutParameterCommand } from "@aws-sdk/client-ssm";

const stage = process.argv[2] || "dev";
const name = `/duportfolioapi/${stage}/sprite-studio/access-key`;
const ssm = new SSMClient({ region: "us-east-1" });
try {
  await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: false }));
} catch (error) {
  if (error?.name !== "ParameterNotFound") throw error;
  const lambda = new LambdaClient({ region: "us-east-1" });
  const current = await lambda.send(new GetFunctionConfigurationCommand({
    FunctionName: `duportfolioapi-${stage}-generateGameAsset`,
  }));
  const key = current.Environment?.Variables?.SPRITE_STUDIO_KEY;
  if (!key) throw new Error("Existing Sprite Studio access key is unavailable.");
  await ssm.send(new PutParameterCommand({ Name: name, Type: "SecureString", Value: key }));
}
process.stdout.write(`Sprite Gen access parameter ready: ${name}\n`);
