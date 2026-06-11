import {
  AddContextDoc,
  AdvanceScheduledNode,
  AddSessionUpload,
  AssignUserRole,
  DeleteAllErrors,
  CreateFlow,
  CreateFlowEdge,
  CreateFlowNode,
  ConfirmAndSend,
  CreateUser,
  DecideApproval,
  DeleteFlow,
  DeleteFlowEdge,
  DeleteFlowNode,
  DeleteUser,
  FailJob,
  GenerateDocument,
  GetEffectivePermissions,
  GetFeatureFlag,
  GetFlowCanvas,
  GetFlowDeepDive,
  GetOverviewDashboard,
  GetSession,
  GetUsageSummary,
  GrantFlowOwner,
  HeartbeatTyping,
  ImportHrDataset,
  IsFeatureEnabled,
  IsFeatureEnabledForUser,
  ListAllSessions,
  ListErrors,
  ListFeatureFlags,
  ListFlows,
  ListFlowsForUser,
  ListJobs,
  ListRoles,
  CreateRole,
  RenameRole,
  DeleteRole,
  ListScheduleRuns,
  ListPendingApprovals,
  ListSessions,
  ListTypingUsers,
  ListUsers,
  ListUsersForRole,
  LogAuditEvent,
  LogError,
  NotifyOnApprovalDecided,
  NotifyOnApprovalRequested,
  NotifyOnFlowShared,
  NotifyOnSessionComplete,
  NotifyOnStepComplete,
  OverrideBranch,
  PingJob,
  RegisterJob,
  ReindexAllDocuments,
  RemoveContextDoc,
  RemoveSessionUpload,
  RemoveUserRole,
  RetrieveDocumentChunks,
  ApplyAutoNodeResult,
  RunAutoNode,
  RunTurn,
  ScheduleNodeEvent,
  SearchPeople,
  SendMessage,
  SetColumnMapping,
  SetFeatureFlagRoles,
  StartSession,
  SuggestApprover,
  SummariseTemplate,
  TrackUsage,
  UpdateErrorStatus,
  UpdateFlow,
  UpdateFlowNode,
  UpdateFlowNodePosition,
  UpdateRolePermissions,
  UpdateUser,
  UpsertFeatureFlag,
} from "@rbrasier/application";
import {
  DocxGenerator,
  DocumentExtractorService,
  DocumentIndexingService,
  DrizzleApprovalRepository,
  DrizzleAuditLogger,
  DrizzleContextDocContentRepository,
  DrizzleConversationRepository,
  DrizzleDocumentChunksRepository,
  DrizzleErrorLogRepository,
  DrizzleErrorLogger,
  DrizzleFeatureFlagRepository,
  DrizzleFeatureFlagRoleRepository,
  DrizzleFlowEdgeRepository,
  DrizzleFlowNodeRepository,
  DrizzleFlowRepository,
  DrizzleHrDatasetRepository,
  DrizzleJobRepository,
  DrizzleNotificationLogRepository,
  DrizzleReindexSourceRepository,
  DrizzleRoleRepository,
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
  DrizzleUserRoleRepository,
  FlowSessionGraph,
  GraphClient,
  GraphPeopleDirectory,
  GraphReportingLineResolver,
  HrPeopleDirectory,
  LangGraphAgentRunner,
  LanguageModelAdapter,
  createEmbeddingsProvider,
  MinioStorageAdapter,
  N8nHttpWorkflowDirectory,
  NodemailerEmailSender,
  PinoLogger,
  PkiCertAdapter,
  RuntimeConfigStore,
  SpreadsheetParser,
  SystemClock,
  createAuth,
  createDatabase,
  createNodeExecutors,
  resolveSession,
  seedAdmin,
  seedRoles,
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
  const featureFlagRoles = new DrizzleFeatureFlagRoleRepository(db);
  const roles = new DrizzleRoleRepository(db);
  const userRoles = new DrizzleUserRoleRepository(db);
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
  const nodeExecutors = createNodeExecutors(llm, env.N8N_WEBHOOK_SECRET);
  const n8nWorkflowDirectory = new N8nHttpWorkflowDirectory(() => runtimeConfig.getN8nConfig());
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
  const notificationConfig = { enabled: env.NOTIFICATIONS_ENABLED, baseUrl: env.BETTER_AUTH_URL };
  const notifyOnSessionComplete = new NotifyOnSessionComplete(
    notificationLog,
    emailSender,
    users,
    flows,
    auditLogger,
    notificationConfig,
  );
  const notifyOnStepComplete = new NotifyOnStepComplete(
    notificationLog,
    emailSender,
    users,
    flows,
    flowNodes,
    sessionMessages,
    auditLogger,
    notificationConfig,
  );
  const notifyOnFlowShared = new NotifyOnFlowShared(
    notificationLog,
    emailSender,
    users,
    auditLogger,
    notificationConfig,
  );
  const notifyOnApprovalRequested = new NotifyOnApprovalRequested(
    notificationLog,
    emailSender,
    users,
    flows,
    auditLogger,
    notificationConfig,
  );
  const notifyOnApprovalDecided = new NotifyOnApprovalDecided(
    notificationLog,
    emailSender,
    users,
    flows,
    auditLogger,
    notificationConfig,
  );

  const approvals = new DrizzleApprovalRepository(db);
  const hrDatasets = new DrizzleHrDatasetRepository(db);
  const spreadsheetParser = new SpreadsheetParser();
  // Reuses the Email-Notifications M365 app registration (ADR-018), degrading to
  // HR/manual resolution when the added Graph scopes are not yet consented.
  const graphConfig =
    env.M365_TENANT_ID && env.M365_CLIENT_ID && env.M365_CLIENT_SECRET
      ? {
          tenantId: env.M365_TENANT_ID,
          clientId: env.M365_CLIENT_ID,
          clientSecret: env.M365_CLIENT_SECRET,
        }
      : null;
  const graphClient = new GraphClient(graphConfig);
  const graphPeopleDirectory = new GraphPeopleDirectory(graphClient);
  const hrPeopleDirectory = new HrPeopleDirectory(hrDatasets);
  const reportingLineResolver = new GraphReportingLineResolver(graphClient, hrDatasets, users);

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
  const reindexSource = new DrizzleReindexSourceRepository(db);
  objectStorage.initialise().catch((error: unknown) => {
    logger.warn("MinIO initialisation failed — object storage unavailable until the server restarts", { error });
  });

  // Promote the seeded admin and seed the system roles once, post-migration.
  // Idempotent; both safely no-op on re-run and never overwrite admin edits.
  void (async () => {
    await seedAdmin(users, env.ADMIN_SEED_EMAIL);
    await seedRoles(roles, featureFlagRoles);
  })().catch((error: unknown) => {
    logger.warn("Role/admin seeding failed — will retry on next server start", { error });
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
    services: { llm, agent, sessionAgent, errorLogger, auditLogger, documentExtractor, documentIndexer, emailSender, n8nWorkflowDirectory },
    repos: { users, conversations, errorLogs, featureFlags, featureFlagRoles, roles, userRoles, usageRepo, jobRepo, flows, flowNodes, flowEdges, sessions, sessionMessages, sessionUploads, sessionTyping, sessionStepOutputs, schedules, scheduleRuns, systemSettings, contextDocContent, documentChunks, reindexSource, notificationLog, approvals, hrDatasets },
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
      isFeatureEnabled: new IsFeatureEnabled(featureFlags),
      isFeatureEnabledForUser: new IsFeatureEnabledForUser(featureFlags, featureFlagRoles, userRoles),
      setFeatureFlagRoles: new SetFeatureFlagRoles(featureFlags, featureFlagRoles),
      upsertFeatureFlag: new UpsertFeatureFlag(featureFlags),
      listFeatureFlags: new ListFeatureFlags(featureFlags),
      listRoles: new ListRoles(roles),
      createRole: new CreateRole(roles),
      renameRole: new RenameRole(roles),
      deleteRole: new DeleteRole(roles),
      updateRolePermissions: new UpdateRolePermissions(roles),
      assignUserRole: new AssignUserRole(roles, userRoles),
      removeUserRole: new RemoveUserRole(roles, userRoles),
      getEffectivePermissions: new GetEffectivePermissions(roles, userRoles),
      listUsersForRole: new ListUsersForRole(roles, userRoles),
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
      reindexAllDocuments: new ReindexAllDocuments(reindexSource, documentIndexer, jobRepo),
      grantFlowOwner: new GrantFlowOwner(flows),
      startSession: new StartSession(sessions, flows, flowNodes, flowEdges),
      listSessions: new ListSessions(sessions),
      listAllSessions: new ListAllSessions(sessions),
      getSession: new GetSession(sessions, sessionMessages, flows, flowNodes, flowEdges),
      runTurn: new RunTurn(sessions, sessionMessages, flowEdges, notifyOnSessionComplete, notifyOnStepComplete),
      runAutoNode: new RunAutoNode(sessions, llm, nodeExecutors, sessionStepOutputs),
      applyAutoNodeResult: new ApplyAutoNodeResult(sessions, flowNodes, flowEdges, sessionStepOutputs, notifyOnSessionComplete, notifyOnStepComplete),
      scheduleNodeEvent: new ScheduleNodeEvent(schedules, clock, llm),
      advanceScheduledNode: new AdvanceScheduledNode(sessions, flowEdges, notifyOnSessionComplete, notifyOnStepComplete),
      notifyOnSessionComplete,
      notifyOnFlowShared,
      listScheduleRuns: new ListScheduleRuns(scheduleRuns),
      overrideBranch: new OverrideBranch(sessions, flowEdges),
      heartbeatTyping: new HeartbeatTyping(sessionTyping),
      listTypingUsers: new ListTypingUsers(sessionTyping, users),
      getOverviewDashboard: new GetOverviewDashboard(analyticsRepo),
      getFlowDeepDive: new GetFlowDeepDive(flows, flowNodes, analyticsRepo, sessionStepOutputs),
      suggestApprover: new SuggestApprover(approvals, flowNodes, reportingLineResolver, users),
      confirmAndSend: new ConfirmAndSend(approvals, auditLogger, notifyOnApprovalRequested),
      decideApproval: new DecideApproval(
        approvals,
        sessions,
        flowEdges,
        sessionStepOutputs,
        auditLogger,
        notifyOnApprovalDecided,
      ),
      listPendingApprovals: new ListPendingApprovals(approvals),
      searchPeople: new SearchPeople([graphPeopleDirectory, hrPeopleDirectory]),
      importHrDataset: new ImportHrDataset(spreadsheetParser, hrDatasets),
      setColumnMapping: new SetColumnMapping(hrDatasets),
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
