import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  Duration,
  Stack,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_ec2 as ec2,
  aws_events as events,
  aws_events_targets as targets,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_rds as rds,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_secretsmanager as secretsmanager,
  type StackProps,
} from "aws-cdk-lib";
import type { Construct } from "constructs";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, "..", "..", "..");
const handlersDirectory = join(here, "..", "handlers");
const openNextOutput = join(repositoryRoot, "apps", "web", ".open-next");

// The framework's own packages are TypeScript source resolved through a
// workspace, so they must be bundled, never marked external. onnxruntime-node is
// the opposite: it is a native binary this target deliberately does not ship
// (ADR-056 §4), so it is excluded and the local embeddings provider is
// unavailable here by construction — which the running app detects and reports.
const EXCLUDED_FROM_BUNDLE = ["@huggingface/transformers", "onnxruntime-node"];

export interface WayfinderLambdaStackProps extends StackProps {
  /** Existing VPC the database lives in. Created outside this stack. */
  readonly vpcId: string;
  /** Secret holding the RDS credentials, used by the proxy and the functions. */
  readonly databaseSecretArn: string;
  /** The RDS instance identifier to place behind the proxy. */
  readonly databaseInstanceIdentifier: string;
  /**
   * Direct (non-proxy) connection string. The session event bus holds a
   * Postgres LISTEN, which needs session mode — RDS Proxy does not provide it
   * (phase §7.6).
   */
  readonly databaseListenUrlSecretArn: string;
  /** Existing bucket for generated documents and uploads. */
  readonly documentsBucketName: string;
  /** Secret holding the application environment: auth keys, provider keys. */
  readonly applicationSecretArn: string;
  /** Shared secret the scheduler tick endpoint checks (SCHEDULER_TICK_SECRET). */
  readonly schedulerTickSecretArn: string;
  /** Public origin of the deployment, e.g. https://wayfinder.example.com. */
  readonly publicBaseUrl: string;
}

export class WayfinderLambdaStack extends Stack {
  constructor(scope: Construct, id: string, props: WayfinderLambdaStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, "Vpc", { vpcId: props.vpcId });
    const databaseSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "DatabaseSecret",
      props.databaseSecretArn,
    );
    const applicationSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "ApplicationSecret",
      props.applicationSecretArn,
    );
    const documentsBucket = s3.Bucket.fromBucketName(
      this,
      "DocumentsBucket",
      props.documentsBucketName,
    );

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, "LambdaSecurityGroup", {
      vpc,
      description: "Wayfinder Lambda functions",
      allowAllOutbound: true,
    });

    // Lambda concurrency multiplied by pool size exhausts RDS without a proxy
    // (phase §7.6). Every function except migrate goes through it.
    const databaseProxy = new rds.DatabaseProxy(this, "DatabaseProxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(
        rds.DatabaseInstance.fromDatabaseInstanceAttributes(this, "Database", {
          instanceIdentifier: props.databaseInstanceIdentifier,
          instanceEndpointAddress: databaseSecret.secretValueFromJson("host").unsafeUnwrap(),
          port: 5432,
          securityGroups: [lambdaSecurityGroup],
        }),
      ),
      secrets: [databaseSecret],
      vpc,
      securityGroups: [lambdaSecurityGroup],
      requireTLS: true,
    });

    const sharedEnvironment: Record<string, string> = {
      NODE_ENV: "production",
      DATABASE_URL: `postgresql://${databaseProxy.endpoint}:5432/wayfinder?sslmode=require`,
      MINIO_BUCKET: props.documentsBucketName,
      MINIO_REGION: this.region,
      // Native S3 signs virtual-hosted style; path style is a MinIO-ism.
      MINIO_PATH_STYLE: "false",
      MINIO_USE_SSL: "true",
      // Hosted embeddings only: onnxruntime-node is not in the artefact.
      EMBEDDINGS_PROVIDER: "openai",
      WEB_BASE_URL: props.publicBaseUrl,
      BETTER_AUTH_URL: props.publicBaseUrl,
    };

    const defaults = {
      runtime: lambda.Runtime.NODEJS_22_X,
      vpc,
      securityGroups: [lambdaSecurityGroup],
      projectRoot: repositoryRoot,
      depsLockFilePath: join(repositoryRoot, "pnpm-lock.yaml"),
      environment: sharedEnvironment,
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: "node22",
        externalModules: EXCLUDED_FROM_BUNDLE,
        tsconfig: join(here, "..", "tsconfig.json"),
      },
    } satisfies Partial<nodejs.NodejsFunctionProps>;

    const grantSecrets = (fn: lambda.Function): void => {
      databaseSecret.grantRead(fn);
      applicationSecret.grantRead(fn);
      documentsBucket.grantReadWrite(fn);
    };

    // There is no hand-written web handler. OpenNext builds the Next.js app from
    // a stock `next build` — which is why it was chosen over the Lambda Web
    // Adapter, whose `output: "standalone"` requirement would change the web
    // build for every provider (ADR-056, Alternatives) — and emits a server
    // bundle this stack consumes. Run `npm run build:web` before `cdk deploy`.
    //
    // A turn runs to roughly 300s, so nothing here may sit on API Gateway's 30s
    // cap; the web function is fronted by a Function URL instead (phase §6).
    const webFunction = new lambda.Function(this, "WebFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset(join(openNextOutput, "server-functions", "default")),
      handler: "index.handler",
      vpc,
      securityGroups: [lambdaSecurityGroup],
      memorySize: 2048,
      timeout: Duration.seconds(300),
      environment: {
        ...sharedEnvironment,
        DATABASE_LISTEN_URL_SECRET_ARN: props.databaseListenUrlSecretArn,
      },
    });
    grantSecrets(webFunction);

    const webFunctionUrl = webFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      // Buffered responses cannot stream a chat turn into the browser.
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    const apiFunction = new nodejs.NodejsFunction(this, "ApiFunction", {
      ...defaults,
      entry: join(handlersDirectory, "api.ts"),
      memorySize: 1024,
      timeout: Duration.seconds(60),
    });
    grantSecrets(apiFunction);

    const apiFunctionUrl = apiFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.BUFFERED,
    });

    const migrateFunction = new nodejs.NodejsFunction(this, "MigrateFunction", {
      ...defaults,
      entry: join(handlersDirectory, "migrate.ts"),
      memorySize: 1024,
      timeout: Duration.minutes(10),
      environment: {
        ...sharedEnvironment,
        // Migrations run DDL, which a proxy in transaction mode will not carry.
        DATABASE_URL: databaseSecret.secretValueFromJson("url").unsafeUnwrap(),
      },
    });
    grantSecrets(migrateFunction);

    const extractionTick = new nodejs.NodejsFunction(this, "ExtractionTickFunction", {
      ...defaults,
      entry: join(handlersDirectory, "tick-extraction.ts"),
      memorySize: 1024,
      timeout: Duration.minutes(5),
    });
    grantSecrets(extractionTick);

    const retentionTick = new nodejs.NodejsFunction(this, "RetentionTickFunction", {
      ...defaults,
      entry: join(handlersDirectory, "tick-retention.ts"),
      memorySize: 512,
      timeout: Duration.minutes(15),
    });
    grantSecrets(retentionTick);

    // One minute is EventBridge's floor. An operator watching a run is not held
    // to it — the run screen drives the batch engine itself (phase §5.4).
    new events.Rule(this, "ExtractionTickRule", {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.LambdaFunction(extractionTick)],
    });

    new events.Rule(this, "RetentionSweepRule", {
      schedule: events.Schedule.rate(Duration.days(1)),
      targets: [new targets.LambdaFunction(retentionTick)],
    });

    // The scheduler needs no function of its own: the firing logic already lives
    // behind an HTTP endpoint on the web app, secret-protected, so EventBridge
    // POSTs it directly rather than through a Lambda that would only forward
    // the call (phase §4.2).
    const schedulerTickSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      "SchedulerTickSecret",
      props.schedulerTickSecretArn,
    );
    const schedulerConnection = new events.Connection(this, "SchedulerTickConnection", {
      authorization: events.Authorization.apiKey(
        "x-scheduler-secret",
        schedulerTickSecret.secretValue,
      ),
      description: "Authenticates the scheduled tick against the web app's internal endpoint",
    });
    const schedulerDestination = new events.ApiDestination(this, "SchedulerTickDestination", {
      connection: schedulerConnection,
      endpoint: `${props.publicBaseUrl}/api/internal/scheduler/tick`,
      httpMethod: events.HttpMethod.POST,
    });

    new events.Rule(this, "SchedulerTickRule", {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new targets.ApiDestination(schedulerDestination)],
    });

    const staticAssetsBucket = new s3.Bucket(this, "StaticAssetsBucket", {
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    new s3deploy.BucketDeployment(this, "StaticAssetsDeployment", {
      sources: [s3deploy.Source.asset(join(openNextOutput, "assets"))],
      destinationBucket: staticAssetsBucket,
    });

    // CloudFront is the single public origin: it fronts the web Function URL and
    // routes the one long-lived path to the always-on SSE service (phase §7.1).
    new cloudfront.Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(webFunctionUrl),
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        // Built assets are immutable and content-hashed; serving them from the
        // function would bill compute for a file read.
        "/_next/static/*": {
          origin: origins.S3BucketOrigin.withOriginAccessControl(staticAssetsBucket),
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        "/v1/webhooks/*": {
          origin: new origins.FunctionUrlOrigin(apiFunctionUrl),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      },
    });
  }
}
