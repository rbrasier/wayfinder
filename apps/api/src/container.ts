import {
  CreateUser,
  DeleteUser,
  FailJob,
  GetFeatureFlag,
  GetSystemHealth,
  GetUsageSummary,
  ListErrors,
  ListFeatureFlags,
  ListJobs,
  ListUsers,
  LogAuditEvent,
  LogError,
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
  DrizzleJobRepository,
  DrizzleUsageRepository,
  DrizzleUserRepository,
  LanguageModelAdapter,
  PinoLogger,
  RedisHealthChecker,
  createDatabase,
  withOptionalLangfuse,
  withUsageTracking,
} from "@rbrasier/adapters";
import type { Env } from "./env.js";

export const buildContainer = (env: Env) => {
  const db = createDatabase(env.DATABASE_URL);
  const logger = new PinoLogger(env.NODE_ENV !== "production");

  const users = new DrizzleUserRepository(db);
  const conversations = new DrizzleConversationRepository(db);
  const errorLogs = new DrizzleErrorLogRepository(db);
  const errorLogger = new DrizzleErrorLogger(errorLogs);
  const auditLogger = new DrizzleAuditLogger(db);
  const featureFlags = new DrizzleFeatureFlagRepository(db);
  const usageRepo = new DrizzleUsageRepository(db);
  const jobRepo = new DrizzleJobRepository(db);

  const baseLlm = new LanguageModelAdapter(env.AI_DEFAULT_PROVIDER);
  const llm = withOptionalLangfuse(withUsageTracking(baseLlm, usageRepo), env);

  const dbChecker = new DbHealthChecker(db);
  const redisChecker = new RedisHealthChecker(env.REDIS_URL);
  const aiChecker = new AiHealthChecker({
    provider: env.AI_DEFAULT_PROVIDER,
    anthropicKey: env.ANTHROPIC_API_KEY,
    openaiKey: env.OPENAI_API_KEY,
    mistralKey: env.MISTRAL_API_KEY,
  });
  const healthChecker = new CompositeHealthChecker(dbChecker, redisChecker, aiChecker, jobRepo);

  return {
    env,
    db,
    logger,
    repos: { users, conversations, errorLogs, featureFlags, usageRepo, jobRepo },
    services: { llm, errorLogger, auditLogger },
    useCases: {
      createUser: new CreateUser(users),
      updateUser: new UpdateUser(users),
      deleteUser: new DeleteUser(users),
      listUsers: new ListUsers(users),
      logError: new LogError(errorLogger),
      listErrors: new ListErrors(errorLogs),
      updateErrorStatus: new UpdateErrorStatus(errorLogs),
      logAuditEvent: new LogAuditEvent(auditLogger),
      getFeatureFlag: new GetFeatureFlag(featureFlags),
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
