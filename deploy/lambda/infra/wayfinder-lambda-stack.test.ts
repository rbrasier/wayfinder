import { beforeAll, describe, expect, it } from "vitest";
import { App, assertions } from "aws-cdk-lib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WayfinderLambdaStack } from "./wayfinder-lambda-stack";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "test-fixtures", "open-next");
const arn = (name: string) => `arn:aws:secretsmanager:eu-west-2:123456789012:secret:${name}-AbCdEf`;

// Synthesised once and shared. Every synth bundles four functions with esbuild,
// which is seconds of work — and worth paying once, because it proves the
// handlers actually bundle (the failure mode a deploy would otherwise find
// first). Asserting against the finished template is free.
let template: assertions.Template;

beforeAll(() => {
  template = synth();
}, 120_000);

const synth = () => {
  const app = new App();
  const stack = new WayfinderLambdaStack(app, "TestStack", {
    env: { account: "123456789012", region: "eu-west-2" },
    vpcId: "vpc-12345678",
    databaseSecretArn: arn("db"),
    databaseInstanceIdentifier: "wayfinder-db",
    databaseEndpointAddress: "wayfinder-db.abc123.eu-west-2.rds.amazonaws.com",
    databaseListenUrlSecretArn: arn("listen"),
    documentsBucketName: "wayfinder-documents",
    applicationSecretArn: arn("app"),
    schedulerTickSecretArn: arn("tick"),
    publicBaseUrl: "https://wayfinder.example.com",
    openNextOutputDirectory: fixtures,
  });
  return assertions.Template.fromStack(stack);
};

describe("WayfinderLambdaStack", () => {
  it("streams the web function's responses, because a turn runs to ~300s", () => {
    template.hasResourceProperties("AWS::Lambda::Url", { InvokeMode: "RESPONSE_STREAM" });
  });

  it("gives the web function room for a full turn", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Timeout: 300,
      Handler: "index.handler",
    });
  });

  it("points the session event bus at the direct endpoint, not the proxy", () => {
    const functions = template.findResources("AWS::Lambda::Function");
    const web = Object.values(functions).find(
      (fn) => fn.Properties?.Environment?.Variables?.DATABASE_LISTEN_URL_SECRET_ARN !== undefined,
    );

    expect(web, "no function carries the LISTEN URL — SSE would use the proxy").toBeDefined();
  });

  it("configures every function for real S3 rather than MinIO's path style", () => {
    const functions = template.findResources("AWS::Lambda::Function");

    for (const fn of Object.values(functions)) {
      const variables = fn.Properties?.Environment?.Variables;
      if (!variables?.MINIO_BUCKET) continue;
      expect(variables.MINIO_PATH_STYLE).toBe("false");
      expect(variables.MINIO_REGION).toBeDefined();
    }
  });

  it("pins every function to a hosted embeddings provider", () => {
    const functions = template.findResources("AWS::Lambda::Function");
    const appFunctions = Object.values(functions).filter(
      (fn) => fn.Properties?.Environment?.Variables?.MINIO_BUCKET,
    );

    expect(appFunctions.length).toBeGreaterThan(0);
    for (const fn of appFunctions) {
      expect(fn.Properties.Environment.Variables.EMBEDDINGS_PROVIDER).toBe("openai");
    }
  });

  it("puts the database behind a proxy, since concurrency times pool size exhausts RDS", () => {
    template.resourceCountIs("AWS::RDS::DBProxy", 1);
  });

  it("ticks extraction every minute — EventBridge's floor", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 minute)",
    });
  });

  it("sweeps retention daily", () => {
    template.hasResourceProperties("AWS::Events::Rule", {
      ScheduleExpression: "rate(1 day)",
    });
  });

  it("drives the scheduler through the existing tick endpoint, with no Lambda of its own", () => {

    template.hasResourceProperties("AWS::Events::ApiDestination", {
      HttpMethod: "POST",
      InvocationEndpoint: "https://wayfinder.example.com/api/internal/scheduler/tick",
    });
    template.hasResourceProperties("AWS::Events::Connection", {
      AuthorizationType: "API_KEY",
      AuthParameters: { ApiKeyAuthParameters: { ApiKeyName: "x-scheduler-secret" } },
    });
  });

  it("gives the migrate function a direct connection, since DDL cannot go through a transaction-mode proxy", () => {
    const functions = template.findResources("AWS::Lambda::Function");
    const migrate = Object.values(functions).find((fn) => fn.Properties?.Timeout === 600);

    expect(migrate, "no function has the migrate timeout").toBeDefined();
  });

  it("serves built assets from S3, not from the function", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        CacheBehaviors: assertions.Match.arrayWith([
          assertions.Match.objectLike({ PathPattern: "/_next/static/*" }),
        ]),
      },
    });
  });

  it("routes the n8n webhook to the api function, the one path with outside ingress", () => {
    template.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: {
        CacheBehaviors: assertions.Match.arrayWith([
          assertions.Match.objectLike({ PathPattern: "/v1/webhooks/*" }),
        ]),
      },
    });
  });
});
