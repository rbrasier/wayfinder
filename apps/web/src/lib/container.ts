import {
  AddContextDoc,
  CreateFlow,
  CreateFlowEdge,
  CreateFlowNode,
  CreateUser,
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
  DrizzleAuditLogger,
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
  DrizzleUsageRepository,
  DrizzleUserRepository,
  FlowSessionGraph,
  LangGraphAgentRunner,
  LanguageModelAdapter,
  LocalDocumentStorage,
  PinoLogger,
  PkiCertAdapter,
  createAuth,
  createDatabase,
  resolveSession,
  withOptionalLangfuse,
  withUsageTracking,
  type AuthMethod,
} from "@rbrasier/adapters";
import { serverEnv } from "./env";

let cached: ReturnType<typeof build> | null = null;

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

  const baseLlm = new LanguageModelAdapter(env.AI_DEFAULT_PROVIDER);
  const llm = withOptionalLangfuse(withUsageTracking(baseLlm, usageRepo), env);
  const agent = new LangGraphAgentRunner(llm);
  const sessionAgent = new FlowSessionGraph();
  const docxGenerator = new DocxGenerator();
  const documentStorage = new LocalDocumentStorage();

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
    resolveSession: (token: string) => resolveSession(db, token),
    services: { llm, agent, sessionAgent, errorLogger, auditLogger },
    repos: { users, conversations, errorLogs, featureFlags, usageRepo, jobRepo, flows, flowNodes, flowEdges, sessions, sessionMessages },
    useCases: {
      generateDocument: new GenerateDocument(docxGenerator, documentStorage, llm, sessionMessages),
      createUser: new CreateUser(users),
      updateUser: new UpdateUser(users),
      deleteUser: new DeleteUser(users),
      listUsers: new ListUsers(users),
      logError: new LogError(errorLogger),
      listErrors: new ListErrors(errorLogs),
      updateErrorStatus: new UpdateErrorStatus(errorLogs),
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
    },
  };
};

export const getContainer = () => {
  if (cached) return cached;
  cached = build();
  return cached;
};

export type Container = ReturnType<typeof getContainer>;
