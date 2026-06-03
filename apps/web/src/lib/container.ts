import {
  AddContextDoc,
  AddSessionUpload,
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
  GetFlowDeepDive,
  GetOverviewDashboard,
  GetSession,
  GetUsageSummary,
  GrantFlowOwner,
  HeartbeatTyping,
  ListAllSessions,
  ListErrors,
  ListFeatureFlags,
  ListFlows,
  ListFlowsForUser,
  ListJobs,
  ListScheduleRuns,
  ListSessions,
  ListTypingUsers,
  ListUsers,
  LogAuditEvent,
  LogError,
  OverrideBranch,
  PingJob,
  RegisterJob,
  RemoveContextDoc,
  RemoveSessionUpload,
  RetrieveDocumentChunks,
  RunAutoNode,
  RunTurn,
  ScheduleNodeEvent,
  SendMessage,
  StartSession,
  SummariseTemplate,
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
  DocumentIndexingService,
  DrizzleAuditLogger,
  DrizzleContextDocContentRepository,
  DrizzleConversationRepository,
  DrizzleDocumentChunksRepository,
  DrizzleErrorLogRepository,
  DrizzleErrorLogger,
  DrizzleFeatureFlagRepository,
  DrizzleFlowEdgeRepository,
  DrizzleFlowNodeRepository,
  DrizzleFlowRepository,
  DrizzleJobRepository,
  DrizzleSessionMessageRepository,
  DrizzleSessionUploadRepository,
  DrizzleSessionTypingRepository,
  DrizzleSessionStepOutputRepository,
  DrizzleScheduleRepository,
  DrizzleScheduleRunRepository,
  DrizzleAnalyticsRepository,
  DrizzleSessionRepository,
  DrizzleSystemSettingsRepository,
  DrizzleUsageRepository,
  DrizzleUserRepository,
  FlowSessionGraph,
  LangGraphAgentRunner,
  LanguageModelAdapter,
  createEmbeddingsProvider,
  MinioStorageAdapter,
  NodemailerEmailSender,
  PinoLogger,
  PkiCertAdapter,
  RuntimeConfigStore,
  SystemClock,
  createAuth,
  createDatabase,
  createNodeExecutor,
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
  const sessionUploads = new DrizzleSessionUploadRepository(db);
  const sessionTyping = new DrizzleSessionTypingRepository(db);
  const sessionStepOutputs = new DrizzleSessionStepOutputRepository(db);
  const schedules = new DrizzleScheduleRepository(db);
  const scheduleRuns = new DrizzleScheduleRunRepository(db);
  const clock = new SystemClock();
  const analyticsRepo = new DrizzleAnalyticsRepository(db);
  const systemSettings = new DrizzleSystemSettingsRepository(db);

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
      endpoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
      bucket: env.MINIO_BUCKET,
    },
    embeddingsProvider: env.EMBEDDINGS_PROVIDER,
  });

  const baseLlm = new LanguageModelAdapter(env.AI_DEFAULT_PROVIDER, runtimeConfig);
  const llm = withOptionalLangfuse(withUsageTracking(baseLlm, usageRepo), env);
  const agent = new LangGraphAgentRunner(llm);
  const sessionAgent = new FlowSessionGraph();
  const docxGenerator = new DocxGenerator();
  const documentExtractor = new DocumentExtractorService(docxGenerator);
  const nodeExecutor = createNodeExecutor(env.N8N_WEBHOOK_SECRET);
  const emailSender = new NodemailerEmailSender(systemSettings);
  const objectStorage = new MinioStorageAdapter(runtimeConfig);
  const contextDocContent = new DrizzleContextDocContentRepository(db);
  const documentChunks = new DrizzleDocumentChunksRepository(db);
  const embeddings = createEmbeddingsProvider(() => runtimeConfig.getEmbeddingsConfig(), {
    openaiApiKey: env.OPENAI_API_KEY ?? null,
    localEnvOptions: {
      allowRemoteModels: env.EMBEDDINGS_ALLOW_REMOTE_MODELS === "false" ? false : undefined,
      localModelPath: env.EMBEDDINGS_LOCAL_MODEL_PATH,
      cacheDir: env.EMBEDDINGS_CACHE_DIR,
    },
  });
  const documentIndexer = new DocumentIndexingService(embeddings, documentChunks);
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
    switch (env.AUTH_METHOD) {
      case "pki":
        return { type: "pki" as const, pkiConfig };
      case "pki-and-email-password":
        return { type: "pki-and-email-password" as const, pkiConfig };
      case "google-oauth":
        return { type: "google-oauth" as const };
      case "other":
        return { type: "other" as const };
      default:
        return { type: "email-password" as const };
    }
  })();

  const pkiCertAdapter =
    env.AUTH_METHOD === "pki" || env.AUTH_METHOD === "pki-and-email-password"
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
    services: { llm, agent, sessionAgent, errorLogger, auditLogger, documentExtractor, documentIndexer, emailSender },
    repos: { users, conversations, errorLogs, featureFlags, usageRepo, jobRepo, flows, flowNodes, flowEdges, sessions, sessionMessages, sessionUploads, sessionTyping, sessionStepOutputs, schedules, scheduleRuns, systemSettings, contextDocContent, documentChunks },
    useCases: {
      generateDocument: new GenerateDocument(docxGenerator, objectStorage, llm, sessionMessages, sessionStepOutputs),
      summariseTemplate: new SummariseTemplate(llm),
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
      addSessionUpload: new AddSessionUpload(sessionUploads),
      removeSessionUpload: new RemoveSessionUpload(sessionUploads),
      retrieveDocumentChunks: new RetrieveDocumentChunks(embeddings, documentChunks),
      grantFlowOwner: new GrantFlowOwner(flows),
      startSession: new StartSession(sessions, flows, flowNodes, flowEdges),
      listSessions: new ListSessions(sessions),
      listAllSessions: new ListAllSessions(sessions),
      getSession: new GetSession(sessions, sessionMessages, flows, flowNodes, flowEdges),
      runTurn: new RunTurn(sessions, sessionMessages, flowEdges),
      runAutoNode: new RunAutoNode(sessions, llm, nodeExecutor),
      scheduleNodeEvent: new ScheduleNodeEvent(schedules, clock),
      listScheduleRuns: new ListScheduleRuns(scheduleRuns),
      overrideBranch: new OverrideBranch(sessions, flowEdges),
      heartbeatTyping: new HeartbeatTyping(sessionTyping),
      listTypingUsers: new ListTypingUsers(sessionTyping, users),
      getOverviewDashboard: new GetOverviewDashboard(analyticsRepo),
      getFlowDeepDive: new GetFlowDeepDive(flows, flowNodes, analyticsRepo, sessionStepOutputs),
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
