import {
  AddContextDoc,
  DeleteAllErrors,
  CreateFlow,
  CreateFlowEdge,
  CreateFlowNode,
  CreateUser,
  DeleteFlow,
  DeleteFlowEdge,
  DeleteFlowNode,
  DeleteUser,
  FailJob,
  GenerateDocument,
  GetFeatureFlag,
  GetFlowCanvas,
  GetSession,
  GetUsageSummary,
  GrantFlowOwner,
  ListAllSessions,
  ListErrors,
  ListFeatureFlags,
  ListFlows,
  ListFlowsForUser,
  ListJobs,
  ListSessions,
  ListUsers,
  LogAuditEvent,
  LogError,
  OverrideBranch,
  PingJob,
  RegisterJob,
  RemoveContextDoc,
  RunTurn,
  SendMessage,
  StartSession,
  TrackUsage,
  UpdateErrorStatus,
  UpdateFlow,
  UpdateFlowNode,
  UpdateFlowNodePosition,
  UpdateUser,
  UpsertFeatureFlag,
} from "@rbrasier/application";
import {
  DocxGenerator,
  DocumentExtractorService,
  DrizzleAuditLogger,
  DrizzleContextDocContentRepository,
  DrizzleConversationRepository,
  DrizzleErrorLogRepository,
  DrizzleErrorLogger,
  DrizzleFeatureFlagRepository,
  DrizzleFlowEdgeRepository,
  DrizzleFlowNodeRepository,
  DrizzleFlowRepository,
  DrizzleJobRepository,
  DrizzleSessionMessageRepository,
  DrizzleSessionRepository,
  DrizzleSystemSettingsRepository,
  DrizzleUsageRepository,
  DrizzleUserRepository,
  FlowSessionGraph,
  LangGraphAgentRunner,
  LanguageModelAdapter,
  MinioStorageAdapter,
  PinoLogger,
  PkiCertAdapter,
  RuntimeConfigStore,
  createAuth,
  createDatabase,
  resolveSession,
  withOptionalLangfuse,
  withUsageTracking,
  type AuthMethod,
} from "@rbrasier/adapters";
import { serverEnv } from "./env";

const globalForContainer = globalThis as typeof globalThis & {
  _wayfinder_container: ReturnType<typeof build> | undefined;
};

const build = () => {
  const env = serverEnv();
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
  const flows = new DrizzleFlowRepository(db);
  const flowNodes = new DrizzleFlowNodeRepository(db);
  const flowEdges = new DrizzleFlowEdgeRepository(db);
  const sessions = new DrizzleSessionRepository(db);
  const sessionMessages = new DrizzleSessionMessageRepository(db);
  const systemSettings = new DrizzleSystemSettingsRepository(db);

  const runtimeConfig = new RuntimeConfigStore(systemSettings, {
    provider: env.AI_DEFAULT_PROVIDER,
    apiKeys: {
      anthropic: env.ANTHROPIC_API_KEY ?? null,
      openai: env.OPENAI_API_KEY ?? null,
      mistral: env.MISTRAL_API_KEY ?? null,
    },
    storage: {
      endpoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
      bucket: env.MINIO_BUCKET,
    },
  });

  const baseLlm = new LanguageModelAdapter(env.AI_DEFAULT_PROVIDER, runtimeConfig);
  const llm = withOptionalLangfuse(withUsageTracking(baseLlm, usageRepo), env);
  const agent = new LangGraphAgentRunner(llm);
  const sessionAgent = new FlowSessionGraph();
  const docxGenerator = new DocxGenerator();
  const documentExtractor = new DocumentExtractorService(docxGenerator);
  const objectStorage = new MinioStorageAdapter(runtimeConfig);
  const contextDocContent = new DrizzleContextDocContentRepository(db);
  objectStorage.initialise().catch((error: unknown) => {
    logger.warn("MinIO initialisation failed — object storage unavailable until the server restarts", { error });
  });

  const pkiConfig = {
    trustedProxyIps: (env.PKI_TRUSTED_PROXY_IPS ?? "")
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean),
    sessionTtlHours: env.PKI_SESSION_TTL_HOURS,
  };

  const authMethod: AuthMethod = (() => {
    const sendMagicLink = async ({ email, url }: { email: string; url: string }) => {
      logger.info(`[auth] magic link for ${email}: ${url}`);
    };
    switch (env.AUTH_METHOD) {
      case "pki":
        return { type: "pki" as const, pkiConfig };
      case "pki-and-magic-link":
        return { type: "pki-and-magic-link" as const, pkiConfig, sendMagicLink };
      case "google-oauth":
        return { type: "google-oauth" as const };
      case "other":
        return { type: "other" as const };
      default:
        return { type: "magic-link" as const, sendMagicLink };
    }
  })();

  const pkiCertAdapter =
    env.AUTH_METHOD === "pki" || env.AUTH_METHOD === "pki-and-magic-link"
      ? new PkiCertAdapter(db, users, pkiConfig)
      : null;

  const auth = createAuth(db, {
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    adminSeedEmail: env.ADMIN_SEED_EMAIL,
    authMethod,
  });

  return {
    env,
    db,
    auth,
    pkiCertAdapter,
    logger,
    objectStorage,
    runtimeConfig,
    resolveSession: (token: string) => resolveSession(db, token),
    services: { llm, agent, sessionAgent, errorLogger, auditLogger, documentExtractor },
    repos: { users, conversations, errorLogs, featureFlags, usageRepo, jobRepo, flows, flowNodes, flowEdges, sessions, sessionMessages, systemSettings, contextDocContent },
    useCases: {
      generateDocument: new GenerateDocument(docxGenerator, objectStorage, llm, sessionMessages),
      createUser: new CreateUser(users),
      updateUser: new UpdateUser(users),
      deleteUser: new DeleteUser(users),
      listUsers: new ListUsers(users),
      logError: new LogError(errorLogger),
      listErrors: new ListErrors(errorLogs),
      updateErrorStatus: new UpdateErrorStatus(errorLogs),
      deleteAllErrors: new DeleteAllErrors(errorLogs),
      sendMessage: new SendMessage(llm, conversations),
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
      createFlow: new CreateFlow(flows),
      deleteFlow: new DeleteFlow(flows),
      listFlows: new ListFlows(flows),
      listFlowsForUser: new ListFlowsForUser(flows),
      getFlowCanvas: new GetFlowCanvas(flows, flowNodes, flowEdges),
      updateFlow: new UpdateFlow(flows),
      createFlowNode: new CreateFlowNode(flowNodes),
      updateFlowNode: new UpdateFlowNode(flowNodes),
      updateFlowNodePosition: new UpdateFlowNodePosition(flowNodes),
      deleteFlowNode: new DeleteFlowNode(flowNodes),
      createFlowEdge: new CreateFlowEdge(flowEdges),
      deleteFlowEdge: new DeleteFlowEdge(flowEdges),
      addContextDoc: new AddContextDoc(flows),
      removeContextDoc: new RemoveContextDoc(flows),
      grantFlowOwner: new GrantFlowOwner(flows),
      startSession: new StartSession(sessions, flows, flowNodes, flowEdges),
      listSessions: new ListSessions(sessions),
      listAllSessions: new ListAllSessions(sessions),
      getSession: new GetSession(sessions, sessionMessages, flows, flowNodes, flowEdges),
      runTurn: new RunTurn(sessions, sessionMessages, flowEdges),
      overrideBranch: new OverrideBranch(sessions, flowEdges),
    },
  };
};

export const getContainer = () => {
  if (globalForContainer._wayfinder_container) {
    return globalForContainer._wayfinder_container;
  }
  globalForContainer._wayfinder_container = build();
  return globalForContainer._wayfinder_container;
};

export type Container = ReturnType<typeof getContainer>;
