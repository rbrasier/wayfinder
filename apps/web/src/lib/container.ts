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
  CreateGroup,
  UpdateGroup,
  DeleteGroup,
  ListGroups,
  ListManageableGroups,
  ListGroupMembers,
  AddGroupMember,
  SetGroupMemberRole,
  RemoveGroupMember,
  ResolveGroupAuthorization,
  ListOrganisations,
  CreateOrganisation,
  UpdateOrganisation,
  DeleteOrganisation,
  AssignUserOrganisation,
  GetOrganisationResolution,
  SetOrganisationResolution,
  SubmitOrganisationNomination,
  ResolveOrganisationOnSignIn,
  CreateUser,
  DecideApproval,
  DeleteFlow,
  DeleteFlowEdge,
  DeleteFlowNode,
  DeleteUser,
  EvaluateStepReadiness,
  CreateBudget,
  UpdateBudget,
  DeleteBudget,
  ListBudgets,
  GetGovernanceDashboard,
  GetUserUsage,
  GetUsageLimitsEnabled,
  SetUsageLimitsEnabled,
  FailJob,
  GetEffectivePermissions,
  GetFeatureFlag,
  GetFlowCanvas,
  GetFlowDeepDive,
  GetFlowVersion,
  GetOverviewDashboard,
  GetSession,
  GetSessionForTurn,
  GetUsageSummary,
  GrantFlowOwner,
  ImportHrDataset,
  IsFeatureEnabled,
  IsFeatureEnabledForUser,
  ListAllSessions,
  ListAllSessionsPage,
  ListErrors,
  ListFeatureFlags,
  ListFlows,
  ListFlowsForUser,
  ListFlowVersions,
  ListJobs,
  ListRoles,
  CreateRole,
  RenameRole,
  DeleteRole,
  ListScheduleRuns,
  ListPendingApprovals,
  ListPendingApprovalsWithContext,
  ListSessions,
  ListSessionsPage,
  ListUsers,
  ListUsersForRole,
  LogAuditEvent,
  LogError,
  NotifyOnApprovalDecided,
  NotifyOnApprovalRequested,
  NotifyOnFlowShared,
  NotifyOnSessionComplete,
  ConfirmStepAdvance,
  NotifyOnStepComplete,
  OverrideBranch,
  PublishFlowVersion,
  RestoreFlowVersion,
  SyncFlowDraft,
  PingJob,
  RegisterJob,
  ReindexAllDocuments,
  RemoveContextDoc,
  RemoveSessionUpload,
  RemoveUserRole,
  ResolveSessionAccess,
  RevokeSessionParticipant,
  RetrieveDocumentChunks,
  SubmitAnswerFeedback,
  ListAnswerFeedback,
  TriageAnswerFeedback,
  ListCuratedChunks,
  SearchKnowledge,
  EditChunk,
  SetChunkStatus,
  TagChunks,
  RevertChunk,
  ListChunkVersions,
  ApplyAutoNodeResult,
  RunAutoNode,
  RunTurn,
  TurnLease,
  ScheduleNodeEvent,
  SearchPeople,
  SendMessage,
  SetColumnMapping,
  SetFeatureFlagRoles,
  StartSession,
  SuggestApprover,
  TrackUsage,
  UpdateErrorStatus,
  UpdateFlow,
  UpdateFlowNode,
  UpdateFlowNodePosition,
  UpdateRolePermissions,
  UpdateUser,
  UpsertFeatureFlag,
} from "@rbrasier/application";
import { buildDocumentUseCases } from "./container-document-use-cases";
import {
  DocxGenerator,
  XlsxGenerator,
  DocumentGeneratorRouter,
  DocumentExtractorService,
  DocumentIndexingService,
  DrizzleApprovalRepository,
  DrizzleAuditLogger,
  DrizzleAuditQueryRepository,
  DrizzleLegalHoldRepository,
  HttpSiemForwarder,
  DrizzleContextDocContentRepository,
  DrizzleConversationRepository,
  DrizzleDocumentChunksRepository,
  DrizzleChunkCurationRepository,
  DrizzleAnswerFeedbackRepository,
  DrizzleHybridRetriever,
  DrizzleErrorLogRepository,
  DrizzleErrorLogger,
  DrizzleFeatureFlagRepository,
  DrizzleFeatureFlagRoleRepository,
  DrizzleFlowEdgeRepository,
  DrizzleFlowNodeRepository,
  DrizzleFlowRepository,
  DrizzleFlowVersionRepository,
  CachedFlowVersionRepository,
  DrizzleHrDatasetRepository,
  DrizzleJobRepository,
  DrizzleNotificationLogRepository,
  DrizzleReindexSourceRepository,
  DrizzleRoleRepository,
  DrizzleGroupRepository,
  DrizzleOrganisationRepository,
  DrizzleSessionMessageRepository,
  DrizzleSessionParticipantRepository,
  DrizzleSessionUploadRepository,
  DrizzleSessionStepOutputRepository,
  DrizzleScheduleRepository,
  DrizzleScheduleRunRepository,
  DrizzleAnalyticsRepository,
  DrizzleBudgetRepository,
  DrizzleSessionRepository,
  DrizzleSystemSettingsRepository,
  DrizzleUnitOfWork,
  InMemoryRateLimiter,
  EncryptedSystemSettingsRepository,
  SettingsEncryptionService,
  createSettingsEncryptionKey,
  DrizzleUsageRepository,
  DrizzleUserRepository,
  DrizzleUserRoleRepository,
  AiColumnMappingDetector,
  CompositeConnectivityTester,
  FlowSessionGraph,
  GraphClient,
  GraphPeopleDirectory,
  GraphReportingLineResolver,
  HrPeopleDirectory,
  LangGraphAgentRunner,
  LanguageModelAdapter,
  LlmCallGovernor,
  createEmbeddingsProvider,
  MinioStorageAdapter,
  N8nHttpWorkflowDirectory,
  NodemailerEmailSender,
  PinoLogger,
  PkiCertAdapter,
  QuotaEnforcer,
  RuntimeConfigStore,
  SpreadsheetParser,
  SystemClock,
  TtlCache,
  createAuth,
  createCachedSessionResolver,
  createDatabase,
  createNodeExecutors,
  createPostgresSessionEventBus,
  seedAdmin,
  seedRoles,
  withOptionalLangfuse,
  withQuotaEnforcement,
  withUsageTracking,
  type AuthMethod,
  type ResolvedSession,
} from "@rbrasier/adapters";
import type { FlowVersion, PermissionKey } from "@rbrasier/domain";
import { buildSkillsAndMcp } from "./container-skills-mcp";
import { createCachedPermissionResolver } from "./cached-permission-resolver";
import {
  createCachedAdminSettings,
  type ResolvedAdminSettings,
} from "./cached-admin-settings";
import { serverEnv } from "./env";

const globalForContainer = globalThis as typeof globalThis & {
  _wayfinder_container: ReturnType<typeof build> | undefined;
};

const build = () => {
  const env = serverEnv();
  const db = createDatabase(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  const logger = new PinoLogger(env.NODE_ENV !== "production");

  // Short-TTL caches in front of the two hottest auth lookups (session +
  // permission resolution). Single-instance correct; promote to a shared store
  // when running multiple instances. See the scaling-new-infrastructure phase doc.
  const sessionCache = new TtlCache<ResolvedSession>({
    ttlMs: env.AUTH_CACHE_TTL_MS,
    maxEntries: env.AUTH_CACHE_MAX_ENTRIES,
  });
  const permissionCache = new TtlCache<Set<PermissionKey>>({
    ttlMs: env.AUTH_CACHE_TTL_MS,
    maxEntries: env.AUTH_CACHE_MAX_ENTRIES,
  });
  const resolveCachedSession = createCachedSessionResolver(db, sessionCache);

  const users = new DrizzleUserRepository(db);
  const conversations = new DrizzleConversationRepository(db);
  const errorLogs = new DrizzleErrorLogRepository(db);
  const errorLogger = new DrizzleErrorLogger(errorLogs);
  // The SIEM config thunk resolves lazily against runtimeConfig (defined below);
  // forward() only runs after the container is fully wired.
  const siemForwarder = new HttpSiemForwarder(() => runtimeConfig.getSiemConfig(), logger);
  const auditLogger = new DrizzleAuditLogger(db, siemForwarder, logger);
  const auditQuery = new DrizzleAuditQueryRepository(db);
  const legalHolds = new DrizzleLegalHoldRepository(db);
  const featureFlags = new DrizzleFeatureFlagRepository(db);
  const featureFlagRoles = new DrizzleFeatureFlagRoleRepository(db);
  const roles = new DrizzleRoleRepository(db);
  const userRoles = new DrizzleUserRoleRepository(db);
  const groups = new DrizzleGroupRepository(db);
  const organisations = new DrizzleOrganisationRepository(db);
  const usageRepo = new DrizzleUsageRepository(db);
  const budgets = new DrizzleBudgetRepository(db);
  const jobRepo = new DrizzleJobRepository(db);
  const flows = new DrizzleFlowRepository(db);
  const flowNodes = new DrizzleFlowNodeRepository(db);
  const flowEdges = new DrizzleFlowEdgeRepository(db);
  // Published versions are immutable snapshots, so cache getById per version id
  // (scaling wall #4) — the runner re-reads the pinned snapshot every turn/poll.
  const flowVersions = new CachedFlowVersionRepository(
    new DrizzleFlowVersionRepository(db),
    new TtlCache<FlowVersion>({ ttlMs: env.FLOW_VERSION_CACHE_TTL_MS, maxEntries: 256 }),
  );
  const sessions = new DrizzleSessionRepository(db);
  const unitOfWork = new DrizzleUnitOfWork(db);
  const sessionParticipants = new DrizzleSessionParticipantRepository(db);
  const sessionMessages = new DrizzleSessionMessageRepository(db);
  const sessionUploads = new DrizzleSessionUploadRepository(db);
  const sessionStepOutputs = new DrizzleSessionStepOutputRepository(db);
  // Real-time transport replacing the 2 s/3 s polls (scaling wall #2). Backed by
  // Postgres LISTEN/NOTIFY on its own direct connection so it stays correct
  // across instances without adding a new service.
  const sessionEvents = createPostgresSessionEventBus(env.DATABASE_LISTEN_URL ?? env.DATABASE_URL);
  const schedules = new DrizzleScheduleRepository(db);
  const scheduleRuns = new DrizzleScheduleRunRepository(db);
  const clock = new SystemClock();
  // Per-instance rate limiters (group F): auth POST keyed by IP, chat stream POST
  // keyed by user id. Same in-process pattern as the auth cache — promoted to a
  // shared store when instance count > 1 (scaling-new-infrastructure phase doc).
  const authRateLimiter = new InMemoryRateLimiter(
    { capacity: env.AUTH_RATE_LIMIT_BURST, refillPerSecond: env.AUTH_RATE_LIMIT_REFILL_PER_SEC },
    env.RATE_LIMIT_MAX_KEYS,
    clock,
  );
  const chatRateLimiter = new InMemoryRateLimiter(
    { capacity: env.CHAT_RATE_LIMIT_BURST, refillPerSecond: env.CHAT_RATE_LIMIT_REFILL_PER_SEC },
    env.RATE_LIMIT_MAX_KEYS,
    clock,
  );
  const analyticsRepo = new DrizzleAnalyticsRepository(db);
  const settingsEncryption = new SettingsEncryptionService(
    createSettingsEncryptionKey(env.SETTINGS_ENCRYPTION_KEY),
  );
  const systemSettings = new EncryptedSystemSettingsRepository(
    new DrizzleSystemSettingsRepository(db),
    settingsEncryption,
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
      endpoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
      bucket: env.MINIO_BUCKET,
    },
    embeddingsProvider: env.EMBEDDINGS_PROVIDER,
    entra:
      env.ENTRA_TENANT_ID && env.ENTRA_CLIENT_ID && env.ENTRA_CLIENT_SECRET
        ? {
            tenantId: env.ENTRA_TENANT_ID,
            clientId: env.ENTRA_CLIENT_ID,
            clientSecret: env.ENTRA_CLIENT_SECRET,
          }
        : undefined,
  });

  // Near-static admin settings cache (scaling wall #4): the chat stream route
  // reads org name, global instructions, and upload config every turn; front
  // them with the same TtlCache shape as the auth caches so a turn no longer
  // pays three settings reads.
  const adminSettingsCache = new TtlCache<ResolvedAdminSettings>({
    ttlMs: env.ADMIN_SETTINGS_CACHE_TTL_MS,
    maxEntries: 1,
  });
  const adminSettings = createCachedAdminSettings(
    {
      getSystemSetting: async (key) => {
        const result = await systemSettings.get(key);
        return result.error ? null : (result.data ?? null);
      },
      getSessionUploadConfig: () => runtimeConfig.getSessionUploadConfig(),
    },
    adminSettingsCache,
  );

  // Shared per-instance provider-call governor (scaling wall #5): bounds
  // concurrent in-flight LLM calls and retries rate limits / transient failures.
  // The same instance governs both the port (LanguageModelAdapter) and the chat
  // stream route's direct SDK calls, so one budget covers every provider request.
  const llmGovernor = new LlmCallGovernor({
    maxConcurrent: env.LLM_MAX_CONCURRENCY,
    maxAttempts: env.LLM_MAX_ATTEMPTS,
  });
  const baseLlm = new LanguageModelAdapter(env.AI_DEFAULT_PROVIDER, runtimeConfig, llmGovernor);
  // Decorator order (ADR-026 §3): quota enforcement is outermost so it blocks
  // before the inner usage-tracking + provider call runs. The same enforcer is
  // shared with the chat stream route, which calls the SDK outside the port.
  const quotaEnforcer = new QuotaEnforcer(
    budgets,
    usageRepo,
    auditLogger,
    userRoles,
    async () => (await runtimeConfig.getUsageLimitsConfig()).enabled,
  );
  const llm = withOptionalLangfuse(
    withQuotaEnforcement(withUsageTracking(baseLlm, usageRepo), quotaEnforcer),
    env,
  );
  const agent = new LangGraphAgentRunner(llm);
  const sessionAgent = new FlowSessionGraph();
  const docxGenerator = new DocxGenerator();
  // Template gen/extraction routes docx vs xlsx by the file's bytes (ADR-039);
  // context-doc extraction stays on docx (context docs are never xlsx templates).
  const documentGenerator = new DocumentGeneratorRouter(docxGenerator, new XlsxGenerator());
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
  // Admins toggle per-trigger notifications at runtime (no restart): read the
  // prefs setting at send time. Triggers without an admin switch stay on.
  const isTriggerEnabled = async (trigger: string): Promise<boolean> => {
    if (trigger !== "session_complete" && trigger !== "flow_shared") return true;
    // Keyed by NOTIFICATION_PREFS_SETTING_KEY (apps don't import domain directly).
    const result = await systemSettings.get("notification_prefs");
    if (result.error || !result.data) return true;
    try {
      const prefs = JSON.parse(result.data.value) as Partial<{
        sessionComplete: boolean;
        flowShared: boolean;
      }>;
      return trigger === "session_complete" ? prefs.sessionComplete !== false : prefs.flowShared !== false;
    } catch {
      return true;
    }
  };
  const notificationConfig = {
    enabled: env.NOTIFICATIONS_ENABLED,
    baseUrl: env.BETTER_AUTH_URL,
    isTriggerEnabled,
  };
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
  const skillsAndMcp = buildSkillsAndMcp({
    db,
    usageRepo,
    quotaEnforcer,
    sessions,
    languageModel: llm,
    sessionStepOutputs,
  });
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
  const chunkCuration = new DrizzleChunkCurationRepository(db);
  const answerFeedback = new DrizzleAnswerFeedbackRepository(db);
  const hybridRetriever = new DrizzleHybridRetriever(db);
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
  const connectivityTester = new CompositeConnectivityTester({
    runtimeConfig,
    emailSender,
    graphClient,
    embeddingsProvider: embeddings,
    openaiApiKey: env.OPENAI_API_KEY ?? null,
  });
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

  // The Better Auth instance reflects the runtime auth config, so it is built
  // lazily and rebuilt whenever the config is invalidated (ADR-025). The auth
  // route resolves the current instance per request — a settings change applies
  // on the next request with no process restart.
  let authInstance: ReturnType<typeof createAuth> | null = null;
  let builtAuthVersion = -1;

  const buildAuth = async () => {
    const authConfig = await runtimeConfig.getAuthConfig();
    return createAuth(db, {
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.BETTER_AUTH_URL,
      adminSeedEmail: env.ADMIN_SEED_EMAIL,
      authMethod,
      authConfig,
    });
  };

  const getAuth = async () => {
    const version = runtimeConfig.getAuthVersion();
    if (authInstance && builtAuthVersion === version) return authInstance;
    authInstance = await buildAuth();
    builtAuthVersion = version;
    return authInstance;
  };

  const getEffectivePermissions = new GetEffectivePermissions(roles, userRoles);
  const resolveEffectivePermissions = createCachedPermissionResolver(
    (userId, isAdmin) => getEffectivePermissions.execute(userId, isAdmin),
    permissionCache,
  );

  return {
    env,
    db,
    getAuth,
    pkiCertAdapter,
    logger,
    objectStorage,
    runtimeConfig,
    adminSettings,
    connectivityTester,
    resolveSession: resolveCachedSession,
    resolveEffectivePermissions,
    services: { llm, agent, sessionAgent, errorLogger, auditLogger, documentExtractor, documentIndexer, emailSender, n8nWorkflowDirectory, quotaEnforcer, llmGovernor, sessionEvents, authRateLimiter, chatRateLimiter, ...skillsAndMcp.services },
    repos: { users, conversations, errorLogs, featureFlags, featureFlagRoles, roles, userRoles, groups, organisations, usageRepo, budgets, jobRepo, flows, flowNodes, flowEdges, flowVersions, sessions, sessionParticipants, sessionMessages, sessionUploads, sessionStepOutputs, schedules, scheduleRuns, systemSettings, contextDocContent, documentChunks, chunkCuration, answerFeedback, hybridRetriever, reindexSource, notificationLog, approvals, hrDatasets, auditQuery, legalHolds, ...skillsAndMcp.repos },
    useCases: {
      ...buildDocumentUseCases({
        documentGenerator,
        objectStorage,
        languageModel: llm,
        sessionMessages,
        sessionStepOutputs,
        sessions,
        flowNodes,
        approvals,
        auditLogger,
      }),
      evaluateStepReadiness: new EvaluateStepReadiness(llm, documentGenerator, objectStorage),
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
      getEffectivePermissions,
      listUsersForRole: new ListUsersForRole(roles, userRoles),
      createGroup: new CreateGroup(groups),
      updateGroup: new UpdateGroup(groups),
      deleteGroup: new DeleteGroup(groups),
      listGroups: new ListGroups(groups),
      listManageableGroups: new ListManageableGroups(groups),
      listGroupMembers: new ListGroupMembers(groups),
      addGroupMember: new AddGroupMember(groups),
      setGroupMemberRole: new SetGroupMemberRole(groups),
      removeGroupMember: new RemoveGroupMember(groups),
      resolveGroupAuthorization: new ResolveGroupAuthorization(groups),
      listOrganisations: new ListOrganisations(organisations),
      createOrganisation: new CreateOrganisation(organisations),
      updateOrganisation: new UpdateOrganisation(organisations),
      deleteOrganisation: new DeleteOrganisation(organisations),
      assignUserOrganisation: new AssignUserOrganisation(users, organisations),
      getOrganisationResolution: new GetOrganisationResolution(systemSettings),
      setOrganisationResolution: new SetOrganisationResolution(systemSettings),
      submitOrganisationNomination: new SubmitOrganisationNomination(users, organisations, systemSettings),
      resolveOrganisationOnSignIn: new ResolveOrganisationOnSignIn(users, organisations, systemSettings),
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
      submitAnswerFeedback: new SubmitAnswerFeedback(answerFeedback),
      listAnswerFeedback: new ListAnswerFeedback(answerFeedback),
      triageAnswerFeedback: new TriageAnswerFeedback(answerFeedback),
      listCuratedChunks: new ListCuratedChunks(chunkCuration),
      searchKnowledge: new SearchKnowledge(embeddings, hybridRetriever),
      editChunk: new EditChunk(chunkCuration, embeddings),
      setChunkStatus: new SetChunkStatus(chunkCuration),
      tagChunks: new TagChunks(chunkCuration),
      revertChunk: new RevertChunk(chunkCuration),
      listChunkVersions: new ListChunkVersions(chunkCuration),
      reindexAllDocuments: new ReindexAllDocuments(reindexSource, documentIndexer, jobRepo),
      grantFlowOwner: new GrantFlowOwner(flows),
      startSession: new StartSession(sessions, flows, flowNodes, flowEdges, flowVersions),
      listSessions: new ListSessions(sessions),
      // Keyset-paginated variants of the two list use cases (phase Group A
      // item 4). Additive server support; tRPC exposure follows.
      listSessionsPage: new ListSessionsPage(sessions),
      listAllSessions: new ListAllSessions(sessions),
      listAllSessionsPage: new ListAllSessionsPage(sessions),
      getSession: new GetSession(sessions, sessionMessages, flows, flowNodes, flowEdges, flowVersions),
      // Leaner turn-scoped variant of getSession: the tail of the transcript
      // plus a SQL-side aggregation of gathered context, so the streaming route
      // stops loading the whole history on every turn (scaling wall #1).
      getSessionForTurn: new GetSessionForTurn(sessions, sessionMessages, flows, flowNodes, flowEdges, flowVersions),
      resolveSessionAccess: new ResolveSessionAccess(sessionParticipants, auditLogger),
      revokeSessionParticipant: new RevokeSessionParticipant(sessionParticipants, auditLogger),
      runTurn: new RunTurn(sessionMessages, flowEdges, unitOfWork, notifyOnSessionComplete, notifyOnStepComplete, flowVersions),
      // The turn lease (scaling wall #3) as one unit: claim (with holder-name
      // resolution), heartbeat, release — so the stream route stops reaching
      // into the session/user repos directly for the lease.
      turnLease: new TurnLease(sessions, users),
      publishFlowVersion: new PublishFlowVersion(flows, flowNodes, flowEdges, flowVersions, auditLogger),
      listFlowVersions: new ListFlowVersions(flowVersions),
      getFlowVersion: new GetFlowVersion(flowVersions),
      restoreFlowVersion: new RestoreFlowVersion(flowVersions, auditLogger),
      syncFlowDraft: new SyncFlowDraft(flows, flowNodes, flowEdges, flowVersions),
      runAutoNode: new RunAutoNode(sessions, llm, nodeExecutors, sessionStepOutputs),
      applyAutoNodeResult: new ApplyAutoNodeResult(sessions, flowNodes, flowEdges, sessionStepOutputs, notifyOnSessionComplete, notifyOnStepComplete),
      scheduleNodeEvent: new ScheduleNodeEvent(schedules, clock, llm),
      advanceScheduledNode: new AdvanceScheduledNode(sessions, flowEdges, notifyOnSessionComplete, notifyOnStepComplete),
      notifyOnSessionComplete,
      notifyOnFlowShared,
      listScheduleRuns: new ListScheduleRuns(scheduleRuns),
      overrideBranch: new OverrideBranch(sessions, flowEdges),
      confirmStepAdvance: new ConfirmStepAdvance(sessions, flowEdges, flowVersions, notifyOnStepComplete),
      getOverviewDashboard: new GetOverviewDashboard(analyticsRepo),
      getGovernanceDashboard: new GetGovernanceDashboard(usageRepo, budgets, users, flows),
      createBudget: new CreateBudget(budgets),
      updateBudget: new UpdateBudget(budgets),
      deleteBudget: new DeleteBudget(budgets),
      listBudgets: new ListBudgets(budgets),
      getUserUsage: new GetUserUsage(systemSettings, budgets, userRoles, usageRepo),
      getUsageLimitsEnabled: new GetUsageLimitsEnabled(systemSettings),
      setUsageLimitsEnabled: new SetUsageLimitsEnabled(systemSettings),
      getFlowDeepDive: new GetFlowDeepDive(flows, flowNodes, analyticsRepo, sessionStepOutputs, flowEdges),
      suggestApprover: new SuggestApprover(
        approvals,
        flowNodes,
        reportingLineResolver,
        users,
        embeddings,
        documentChunks,
        llm,
      ),
      confirmAndSend: new ConfirmAndSend(approvals, auditLogger, notifyOnApprovalRequested),
      decideApproval: new DecideApproval(
        unitOfWork,
        approvals,
        sessions,
        flowEdges,
        sessionStepOutputs,
        auditLogger,
        notifyOnApprovalDecided,
        sessionMessages,
        users,
      ),
      listPendingApprovals: new ListPendingApprovals(approvals),
      listPendingApprovalsWithContext: new ListPendingApprovalsWithContext(
        approvals,
        sessions,
        users,
        sessionMessages,
        sessionStepOutputs,
        flowNodes,
      ),
      searchPeople: new SearchPeople([graphPeopleDirectory, hrPeopleDirectory]),
      importHrDataset: new ImportHrDataset(
        spreadsheetParser,
        hrDatasets,
        new AiColumnMappingDetector(llm),
      ),
      setColumnMapping: new SetColumnMapping(hrDatasets),
      ...skillsAndMcp.useCases,
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
