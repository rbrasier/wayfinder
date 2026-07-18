import type {
  IAuditLogger,
  IConversationRepository,
  IErrorLogRepository,
  IFeatureFlagRepository,
  IJobRepository,
  ILanguageModel,
  ILogger,
  ISystemSettingsRepository,
  IUsageRepository,
  IUserRepository,
} from "@rbrasier/domain";
import { EMBEDDINGS_DEFAULT_PROVIDER } from "@rbrasier/shared";
import { DrizzleSystemSettingsRepository } from "./repositories/drizzle-system-settings-repository";
import { RuntimeConfigStore } from "./config/runtime-config-store";
import { AiHealthChecker } from "./health/ai-health-checker";
import { CompositeHealthChecker } from "./health/composite-health-checker";
import { DbHealthChecker } from "./health/db-health-checker";
import { withOptionalLangfuse } from "./observability/langfuse-tracing-adapter";
import { withUsageTracking } from "./observability/usage-tracking-adapter";
import { DrizzleAuditLogger } from "./audit/drizzle-audit-logger";
import { HttpSiemForwarder } from "./audit/http-siem-forwarder";
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
  aiProvider: "anthropic" | "openai" | "mistral" | "bedrock";
  nodeEnv?: string;
  langfuse?: {
    publicKey?: string;
    secretKey?: string;
    host?: string;
  };
  aiKeys?: {
    anthropic?: string;
    openai?: string;
    mistral?: string;
    bedrock?: {
      region: string;
      accessKeyId: string;
      secretAccessKey: string;
    };
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
    systemSettingsRepo?: ISystemSettingsRepository;
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
  const errorLogger = new DrizzleErrorLogger(errorLogs);

  const systemSettings = overrides.systemSettingsRepo ?? new DrizzleSystemSettingsRepository(db);
  const runtimeConfig = new RuntimeConfigStore(systemSettings, {
    provider: aiProvider,
    apiKeys: {
      anthropic: aiKeys.anthropic ?? null,
      openai: aiKeys.openai ?? null,
      mistral: aiKeys.mistral ?? null,
      bedrock: aiKeys.bedrock ?? null,
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
  const siemForwarder = new HttpSiemForwarder(() => runtimeConfig.getSiemConfig(), logger);
  const auditLogger =
    overrides.auditLogger ?? new DrizzleAuditLogger(db, siemForwarder, logger);
  let llm: ILanguageModel =
    overrides.llm ?? new LanguageModelAdapter(aiProvider, runtimeConfig);
  llm = withUsageTracking(llm, usageRepo);
  llm = withOptionalLangfuse(llm, {
    LANGFUSE_PUBLIC_KEY: langfuse.publicKey,
    LANGFUSE_SECRET_KEY: langfuse.secretKey,
    LANGFUSE_HOST: langfuse.host,
  });

  const agent = new LangGraphAgentRunner(llm);

  const dbChecker = new DbHealthChecker(db);
  const aiChecker = new AiHealthChecker({
    provider: aiProvider,
    anthropicKey: aiKeys.anthropic,
    openaiKey: aiKeys.openai,
    mistralKey: aiKeys.mistral,
  });
  const health = new CompositeHealthChecker(dbChecker, aiChecker, jobRepo);

  return {
    logger,
    repos: { users, conversations, errorLogs, featureFlags, usageRepo, jobRepo },
    services: { llm, agent, errorLogger, auditLogger },
    health,
  };
}
