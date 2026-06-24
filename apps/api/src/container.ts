import {
  ApplyAutoNodeResult,
  CreateUser,
  DeleteUser,
  FailJob,
  GetFeatureFlag,
  GetSystemHealth,
  GetUsageSummary,
  IsFeatureEnabled,
  ListErrors,
  ListFeatureFlags,
  ListJobs,
  ListUsers,
  LogAuditEvent,
  LogError,
  NotifyOnSessionComplete,
  NotifyOnStepComplete,
  PingJob,
  RegisterJob,
  TrackUsage,
  UpdateErrorStatus,
  UpdateUser,
  UpsertFeatureFlag,
} from "@rbrasier/application";
import {
  AiHealthChecker,
  CompositeHealthChecker,
  DbHealthChecker,
  DrizzleAuditLogger,
  DrizzleConversationRepository,
  DrizzleErrorLogRepository,
  DrizzleErrorLogger,
  DrizzleFeatureFlagRepository,
  DrizzleFlowEdgeRepository,
  DrizzleFlowNodeRepository,
  DrizzleFlowRepository,
  DrizzleJobRepository,
  DrizzleNotificationLogRepository,
  DrizzleSessionMessageRepository,
  DrizzleSessionRepository,
  DrizzleSessionStepOutputRepository,
  DrizzleSystemSettingsRepository,
  DrizzleUsageRepository,
  DrizzleUserRepository,
  LanguageModelAdapter,
  NodemailerEmailSender,
  PinoLogger,
  RuntimeConfigStore,
  SchedulerWorker,
  createDatabase,
  withOptionalLangfuse,
  withUsageTracking,
} from "@rbrasier/adapters";
import { HttpTickFirer } from "./scheduler/http-tick-firer.js";
import { EMBEDDINGS_DEFAULT_PROVIDER } from "@rbrasier/shared";
import type { Env } from "./env.js";

export const buildContainer = (env: Env) => {
  const db = createDatabase(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  const logger = new PinoLogger(env.NODE_ENV !== "production");

  const users = new DrizzleUserRepository(db);
  const conversations = new DrizzleConversationRepository(db);
  const errorLogs = new DrizzleErrorLogRepository(db);
  const errorLogger = new DrizzleErrorLogger(errorLogs);
  const auditLogger = new DrizzleAuditLogger(db);
  const featureFlags = new DrizzleFeatureFlagRepository(db);
  const usageRepo = new DrizzleUsageRepository(db);
  const jobRepo = new DrizzleJobRepository(db);
  const systemSettings = new DrizzleSystemSettingsRepository(db);
  const sessions = new DrizzleSessionRepository(db);
  const flows = new DrizzleFlowRepository(db);
  const flowNodes = new DrizzleFlowNodeRepository(db);
  const flowEdges = new DrizzleFlowEdgeRepository(db);
  const sessionStepOutputs = new DrizzleSessionStepOutputRepository(db);
  const sessionMessages = new DrizzleSessionMessageRepository(db);

  const smtpEnvConfig = env.SMTP_TRANSPORT_MODE
    ? {
        mode: env.SMTP_TRANSPORT_MODE,
        host: env.SMTP_HOST ?? null,
        port: env.SMTP_PORT ?? null,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER ?? null,
        pass: env.SMTP_PASS ?? null,
        from: env.SMTP_FROM ?? null,
        m365TenantId: env.M365_TENANT_ID ?? null,
        m365ClientId: env.M365_CLIENT_ID ?? null,
        m365ClientSecret: env.M365_CLIENT_SECRET ?? null,
      }
    : null;
  const emailSender = new NodemailerEmailSender(systemSettings, smtpEnvConfig);
  const notificationLog = new DrizzleNotificationLogRepository(db);
  const notifyOnSessionComplete = new NotifyOnSessionComplete(
    notificationLog,
    emailSender,
    users,
    flows,
    auditLogger,
    { enabled: env.NOTIFICATIONS_ENABLED, baseUrl: env.WEB_BASE_URL },
  );
  const notifyOnStepComplete = new NotifyOnStepComplete(
    notificationLog,
    emailSender,
    users,
    flows,
    flowNodes,
    sessionMessages,
    auditLogger,
    { enabled: env.NOTIFICATIONS_ENABLED, baseUrl: env.WEB_BASE_URL },
  );

  const bedrockEnvCredentials =
    env.AWS_BEDROCK_REGION && env.AWS_BEDROCK_ACCESS_KEY_ID && env.AWS_BEDROCK_SECRET_ACCESS_KEY
      ? {
          region: env.AWS_BEDROCK_REGION,
          accessKeyId: env.AWS_BEDROCK_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_BEDROCK_SECRET_ACCESS_KEY,
        }
      : null;

  const runtimeConfig = new RuntimeConfigStore(systemSettings, {
    provider: env.AI_DEFAULT_PROVIDER,
    apiKeys: {
      anthropic: env.ANTHROPIC_API_KEY ?? null,
      openai: env.OPENAI_API_KEY ?? null,
      mistral: env.MISTRAL_API_KEY ?? null,
      bedrock: bedrockEnvCredentials,
    },
    storage: {
      endpoint: "localhost",
      port: 9000,
      useSSL: false,
      accessKey: "minioadmin",
      secretKey: "minioadmin",
      bucket: "wayfinder-documents",
    },
    embeddingsProvider: EMBEDDINGS_DEFAULT_PROVIDER,
  });

  const baseLlm = new LanguageModelAdapter(env.AI_DEFAULT_PROVIDER, runtimeConfig);
  const llm = withOptionalLangfuse(withUsageTracking(baseLlm, usageRepo), env);

  const dbChecker = new DbHealthChecker(db);
  const aiChecker = new AiHealthChecker({
    provider: env.AI_DEFAULT_PROVIDER,
    anthropicKey: env.ANTHROPIC_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    mistralKey: env.MISTRAL_API_KEY,
    bedrockRegion: env.AWS_BEDROCK_REGION,
    bedrockAccessKeyId: env.AWS_BEDROCK_ACCESS_KEY_ID,
    bedrockSecretAccessKey: env.AWS_BEDROCK_SECRET_ACCESS_KEY,
  });
  const healthChecker = new CompositeHealthChecker(dbChecker, aiChecker, jobRepo);

  // The scheduler heartbeat: a tick loop (cron) that POSTs the web tick endpoint
  // each interval and reports health to job_registry. The firing logic itself
  // lives behind that endpoint (where the AI turn machinery is). Only started
  // when both the URL and shared secret are configured.
  const schedulerWorker =
    env.SCHEDULER_TICK_URL && env.SCHEDULER_TICK_SECRET
      ? new SchedulerWorker(
          new HttpTickFirer(env.SCHEDULER_TICK_URL, env.SCHEDULER_TICK_SECRET),
          jobRepo,
          logger,
          { tickIntervalMs: env.SCHEDULER_TICK_MS },
        )
      : null;

  return {
    env,
    db,
    logger,
    runtimeConfig,
    schedulerWorker,
    repos: { users, conversations, errorLogs, featureFlags, usageRepo, jobRepo, systemSettings, sessions, flowNodes, flowEdges, sessionStepOutputs },
    services: { llm, errorLogger, auditLogger },
    useCases: {
      applyAutoNodeResult: new ApplyAutoNodeResult(sessions, flowNodes, flowEdges, sessionStepOutputs, notifyOnSessionComplete, notifyOnStepComplete),
      createUser: new CreateUser(users),
      updateUser: new UpdateUser(users),
      deleteUser: new DeleteUser(users),
      listUsers: new ListUsers(users),
      logError: new LogError(errorLogger),
      listErrors: new ListErrors(errorLogs),
      updateErrorStatus: new UpdateErrorStatus(errorLogs),
      logAuditEvent: new LogAuditEvent(auditLogger),
      getFeatureFlag: new GetFeatureFlag(featureFlags),
      isFeatureEnabled: new IsFeatureEnabled(featureFlags),
      upsertFeatureFlag: new UpsertFeatureFlag(featureFlags),
      listFeatureFlags: new ListFeatureFlags(featureFlags),
      trackUsage: new TrackUsage(usageRepo),
      getUsageSummary: new GetUsageSummary(usageRepo),
      registerJob: new RegisterJob(jobRepo),
      pingJob: new PingJob(jobRepo),
      failJob: new FailJob(jobRepo),
      listJobs: new ListJobs(jobRepo),
      getSystemHealth: new GetSystemHealth(healthChecker),
    },
  };
};

export type Container = ReturnType<typeof buildContainer>;
