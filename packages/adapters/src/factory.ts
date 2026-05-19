import type {
  IAuditLogger,
  IConversationRepository,
  IErrorLogRepository,
  IFeatureFlagRepository,
  IJobRepository,
  ILanguageModel,
  ILogger,
  IUsageRepository,
  IUserRepository,
} from "@rbrasier/domain";
import { AiHealthChecker } from "./health/ai-health-checker";
import { CompositeHealthChecker } from "./health/composite-health-checker";
import { DbHealthChecker } from "./health/db-health-checker";
import { RedisHealthChecker } from "./health/redis-health-checker";
import { withOptionalLangfuse } from "./observability/langfuse-tracing-adapter";
import { withUsageTracking } from "./observability/usage-tracking-adapter";
import { DrizzleAuditLogger } from "./audit/drizzle-audit-logger";
import { LanguageModelAdapter } from "./ai/language-model-adapter";
import { LangGraphAgentRunner } from "./agents/langgraph-agent-runner";
import { DrizzleConversationRepository } from "./repositories/drizzle-conversation-repository";
import { DrizzleErrorLogRepository } from "./repositories/drizzle-error-log-repository";
import { DrizzleErrorLogger } from "./errors/drizzle-error-logger";
import { DrizzleFeatureFlagRepository } from "./repositories/drizzle-feature-flag-repository";
import { DrizzleJobRepository } from "./repositories/drizzle-job-repository";
import { DrizzleUsageRepository } from "./repositories/drizzle-usage-repository";
import { DrizzleUserRepository } from "./repositories/drizzle-user-repository";
import { PinoLogger } from "./logging/pino-logger";
import type { Database } from "./db/client";

export interface AdaptersConfig {
  aiProvider: "anthropic" | "openai" | "mistral";
  nodeEnv?: string;
  redisUrl?: string;
  langfuse?: {
    publicKey?: string;
    secretKey?: string;
    host?: string;
  };
  aiKeys?: {
    anthropic?: string;
    openai?: string;
    mistral?: string;
  };
  overrides?: {
    logger?: ILogger;
    userRepo?: IUserRepository;
    conversationRepo?: IConversationRepository;
    errorLogRepo?: IErrorLogRepository;
    featureFlagRepo?: IFeatureFlagRepository;
    usageRepo?: IUsageRepository;
    jobRepo?: IJobRepository;
    auditLogger?: IAuditLogger;
    llm?: ILanguageModel;
  };
}

export interface Adapters {
  logger: ILogger;
  repos: {
    users: IUserRepository;
    conversations: IConversationRepository;
    errorLogs: IErrorLogRepository;
    featureFlags: IFeatureFlagRepository;
    usageRepo: IUsageRepository;
    jobRepo: IJobRepository;
  };
  services: {
    llm: ILanguageModel;
    agent: LangGraphAgentRunner;
    errorLogger: DrizzleErrorLogger;
    auditLogger: IAuditLogger;
  };
  health: CompositeHealthChecker;
}

/**
 * Factory that wires all framework adapters from a database connection and config.
 * Pass `overrides` to swap any adapter for a custom implementation.
 */
export function createAdapters(db: Database, config: AdaptersConfig): Adapters {
  const {
    aiProvider,
    nodeEnv = "production",
    redisUrl = "redis://localhost:6379",
    langfuse = {},
    aiKeys = {},
    overrides = {},
  } = config;

  const logger = overrides.logger ?? new PinoLogger(nodeEnv !== "production");

  const users = overrides.userRepo ?? new DrizzleUserRepository(db);
  const conversations = overrides.conversationRepo ?? new DrizzleConversationRepository(db);
  const errorLogs = overrides.errorLogRepo ?? new DrizzleErrorLogRepository(db);
  const featureFlags = overrides.featureFlagRepo ?? new DrizzleFeatureFlagRepository(db);
  const usageRepo = overrides.usageRepo ?? new DrizzleUsageRepository(db);
  const jobRepo = overrides.jobRepo ?? new DrizzleJobRepository(db);
  const auditLogger = overrides.auditLogger ?? new DrizzleAuditLogger(db);
  const errorLogger = new DrizzleErrorLogger(errorLogs);

  let llm: ILanguageModel =
    overrides.llm ?? new LanguageModelAdapter(aiProvider);
  llm = withUsageTracking(llm, usageRepo);
  llm = withOptionalLangfuse(llm, {
    LANGFUSE_PUBLIC_KEY: langfuse.publicKey,
    LANGFUSE_SECRET_KEY: langfuse.secretKey,
    LANGFUSE_HOST: langfuse.host,
  });

  const agent = new LangGraphAgentRunner(llm);

  const dbChecker = new DbHealthChecker(db);
  const redisChecker = new RedisHealthChecker(redisUrl);
  const aiChecker = new AiHealthChecker({
    provider: aiProvider,
    anthropicKey: aiKeys.anthropic,
    openaiKey: aiKeys.openai,
    mistralKey: aiKeys.mistral,
  });
  const health = new CompositeHealthChecker(dbChecker, redisChecker, aiChecker, jobRepo);

  return {
    logger,
    repos: { users, conversations, errorLogs, featureFlags, usageRepo, jobRepo },
    services: { llm, agent, errorLogger, auditLogger },
    health,
  };
}
