import { buildRetentionPolicies } from "@rbrasier/domain";
import {
  ApplyAutoNodeResult,
  ApplyRetentionPolicies,
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
  AdvanceBatchRuns,
  NotifyOnSessionComplete,
  NotifyOnStepComplete,
  PingJob,
  ProcessExtractionTask,
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
  DrizzleLegalHoldRepository,
  HttpSiemForwarder,
  DrizzleFlowEdgeRepository,
  DrizzleFlowNodeRepository,
  DrizzleFlowRepository,
  DrizzleJobRepository,
  DrizzleNotificationLogRepository,
  DrizzleRetentionRepository,
  DrizzleSessionMessageRepository,
  DrizzleSessionRepository,
  DrizzleSessionStepOutputRepository,
  DrizzleSystemSettingsRepository,
  EncryptedSystemSettingsRepository,
  SettingsEncryptionService,
  createSettingsEncryptionKey,
  DrizzleUsageRepository,
  DrizzleUserRepository,
  DrizzleExtractionRunRepository,
  DrizzleFlowVersionRepository,
  DocumentExtractorService,
  DocxGenerator,
  ExtractionWorker,
  LanguageModelAdapter,
  MinioStorageAdapter,
  NodemailerEmailSender,
  PinoLogger,
  RetentionWorker,
  RuntimeConfigStore,
  SchedulerWorker,
  SystemClock,
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
  // The SIEM config thunk resolves lazily against runtimeConfig (defined below);
  // forward() is only ever called long after the container is fully wired.
  const siemForwarder = new HttpSiemForwarder(() => runtimeConfig.getSiemConfig(), logger);
  const auditLogger = new DrizzleAuditLogger(db, siemForwarder, logger);
  const legalHolds = new DrizzleLegalHoldRepository(db);
  const featureFlags = new DrizzleFeatureFlagRepository(db);
  const usageRepo = new DrizzleUsageRepository(db);
  const jobRepo = new DrizzleJobRepository(db);
  const systemSettings = new EncryptedSystemSettingsRepository(
    new DrizzleSystemSettingsRepository(db),
    new SettingsEncryptionService(createSettingsEncryptionKey(env.SETTINGS_ENCRYPTION_KEY)),
  );
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
  // One worker per configured slot; the SKIP LOCKED claim keeps their batches
  // disjoint, so running several simply drains the queue faster (ADR-019).
  const schedulerTickUrl = env.SCHEDULER_TICK_URL;
  const schedulerTickSecret = env.SCHEDULER_TICK_SECRET;
  const schedulerWorkers =
    schedulerTickUrl && schedulerTickSecret
      ? Array.from(
          { length: env.SCHEDULER_WORKER_COUNT },
          () =>
            new SchedulerWorker(
              new HttpTickFirer(schedulerTickUrl, schedulerTickSecret),
              jobRepo,
              logger,
              { tickIntervalMs: env.SCHEDULER_TICK_MS },
            ),
        )
      : [];

  // Retention sweep (scaling wall #9): a slow background worker that prunes the
  // unbounded-growth tables. Only started when explicitly enabled; windows come
  // from env, with audit and conversation history defaulting to keep-forever.
  const retentionRepository = new DrizzleRetentionRepository(db);
  const retentionPolicies = buildRetentionPolicies({
    aiUsageEventsDays: env.RETENTION_USAGE_EVENTS_DAYS,
    appSessionMessagesDays: env.RETENTION_SESSION_MESSAGES_DAYS,
    coreAuditLogDays: env.RETENTION_AUDIT_LOG_DAYS,
    appErrorLogDays: env.RETENTION_ERROR_LOG_DAYS,
    appNotificationLogDays: env.RETENTION_NOTIFICATION_LOG_DAYS,
    appExtractionRunsDays: env.RETENTION_EXTRACTION_RUNS_DAYS,
  });
  const applyRetentionPolicies = new ApplyRetentionPolicies(
    retentionRepository,
    retentionPolicies,
    new SystemClock(),
    legalHolds,
    {
      batchSize: env.RETENTION_BATCH_SIZE,
      maxBatchesPerTarget: env.RETENTION_MAX_BATCHES_PER_TARGET,
    },
  );
  const retentionWorkers = env.RETENTION_ENABLED
    ? [
        new RetentionWorker(applyRetentionPolicies, jobRepo, logger, {
          tickIntervalMs: env.RETENTION_TICK_MS,
        }),
      ]
    : [];

  // Extraction batch engine (ADR-033 §6): a second poller alongside the
  // scheduler that advances every claimable run one batch per tick, in-process
  // with the decorated model so usage metering and spend caps apply
  // automatically. Only started when enabled.
  const flowVersions = new DrizzleFlowVersionRepository(db);
  const extractionRuns = new DrizzleExtractionRunRepository(db);
  const objectStorage = new MinioStorageAdapter(runtimeConfig);
  const documentExtractor = new DocumentExtractorService(new DocxGenerator());
  const advanceBatchRuns = new AdvanceBatchRuns(
    extractionRuns,
    flowVersions,
    new ProcessExtractionTask(extractionRuns, objectStorage, documentExtractor, llm),
    // The per-run cost ceiling is the admin ExtractionConfig value (resolved each
    // tick from system_settings), not an env var.
    { resolveCostCeilingUsd: () => runtimeConfig.getExtractionConfig().then((c) => c.perRunCostCeilingUsd) },
  );
  const extractionWorkers = env.EXTRACTION_WORKER_ENABLED
    ? [
        new ExtractionWorker(advanceBatchRuns, jobRepo, logger, {
          tickIntervalMs: env.EXTRACTION_TICK_MS,
        }),
      ]
    : [];

  return {
    env,
    db,
    logger,
    runtimeConfig,
    schedulerWorkers,
    retentionWorkers,
    extractionWorkers,
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
