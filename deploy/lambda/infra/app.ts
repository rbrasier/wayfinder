#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { WayfinderLambdaStack } from "./wayfinder-lambda-stack.js";

// Every value here names infrastructure created outside this stack — the
// database, its secrets, and the documents bucket are prerequisites the
// installation guide walks through, not things a deployment tool should own.
const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See docs/guides/setup-aws-lambda.md.`);
  return value;
};

const app = new App();

new WayfinderLambdaStack(app, process.env.WAYFINDER_STACK_NAME ?? "Wayfinder", {
  env: { account: required("CDK_DEFAULT_ACCOUNT"), region: required("CDK_DEFAULT_REGION") },
  vpcId: required("WAYFINDER_VPC_ID"),
  databaseSecretArn: required("WAYFINDER_DATABASE_SECRET_ARN"),
  databaseInstanceIdentifier: required("WAYFINDER_DATABASE_INSTANCE_ID"),
  databaseEndpointAddress: required("WAYFINDER_DATABASE_ENDPOINT"),
  databaseListenUrlSecretArn: required("WAYFINDER_DATABASE_LISTEN_URL_SECRET_ARN"),
  documentsBucketName: required("WAYFINDER_DOCUMENTS_BUCKET"),
  applicationSecretArn: required("WAYFINDER_APPLICATION_SECRET_ARN"),
  schedulerTickSecretArn: required("WAYFINDER_SCHEDULER_TICK_SECRET_ARN"),
  publicBaseUrl: required("WAYFINDER_PUBLIC_BASE_URL"),
});
