import {
  ConfigureWebhookTrigger,
  CountWatchesNeedingAttention,
  CreateEventWatch,
  DeleteEventWatch,
  ListEventWatches,
  ListTriggerRuns,
  NotifyUnattendedIncident,
  PauseEventWatch,
  PreviewEventWatch,
  ResumeEventWatch,
  RotateWebhookToken,
  RunAiTaskNode,
  RunEmailNode,
  SetTriggerInputs,
  SetWebhookHmac,
  StartFlowFromWebhook,
  StartSession,
  StartUnattendedRun,
  TestEventWatch,
  UpdateEventWatch,
  type ConfirmAndSend,
  type NotificationConfig,
} from "@rbrasier/application";
import {
  DrizzleEventWatchRepository,
  DrizzleFlowTriggerRepository,
  FetchOutboundHttpClient,
  DrizzleUnattendedRunRepository,
  InMemoryRateLimiter,
  SystemClock,
  nodeWebhookCrypto,
  type createDatabase,
  type SecretCipher,
} from "@rbrasier/adapters";
import type {
  AutomationConfig,
  IApprovalRepository,
  IAuditLogger,
  IEmailSender,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  IFlowRepository,
  IFlowVersionRepository,
  IGroupRepository,
  ILanguageModel,
  INotificationLogRepository,
  IObjectStorage,
  IReportingLineResolver,
  ISessionMessageRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
  IUserRepository,
} from "@rbrasier/domain";

export interface AutomationDependencies {
  db: ReturnType<typeof createDatabase>;
  secretCipher: SecretCipher;
  languageModel: ILanguageModel;
  sessions: ISessionRepository;
  sessionMessages: ISessionMessageRepository;
  sessionStepOutputs: ISessionStepOutputRepository;
  flows: IFlowRepository;
  flowNodes: IFlowNodeRepository;
  flowEdges: IFlowEdgeRepository;
  flowVersions: IFlowVersionRepository;
  approvals: IApprovalRepository;
  confirmAndSend: ConfirmAndSend;
  reportingLineResolver: IReportingLineResolver;
  users: IUserRepository;
  groups: IGroupRepository;
  objectStorage: IObjectStorage;
  emailSender: IEmailSender;
  notificationLog: INotificationLogRepository;
  notificationConfig: NotificationConfig;
  auditLogger: IAuditLogger;
  loadAutomationConfig: () => Promise<AutomationConfig>;
}

// The unattended-automation module (ADR-063–065), built outside container.ts so
// that file stays under the source-size ceiling. The run driver itself is built
// in lib/automation, because it reaches into the chat machinery.
export const buildAutomation = (deps: AutomationDependencies) => {
  const flowTriggers = new DrizzleFlowTriggerRepository(deps.db, deps.secretCipher);
  const unattendedRuns = new DrizzleUnattendedRunRepository(deps.db);
  const eventWatches = new DrizzleEventWatchRepository(deps.db, deps.secretCipher);
  const outboundHttp = new FetchOutboundHttpClient();
  const graph = { flowVersions: deps.flowVersions, flowNodes: deps.flowNodes, flowEdges: deps.flowEdges };
  const webhookDependencies = {
    flows: deps.flows,
    triggers: flowTriggers,
    crypto: nodeWebhookCrypto,
    auditLogger: deps.auditLogger,
  };
  const watchLifecycleDependencies = {
    watches: eventWatches,
    auditLogger: deps.auditLogger,
    newId: () => globalThis.crypto.randomUUID(),
    now: () => new Date(),
  };
  const saveWatchDependencies = {
    watches: eventWatches,
    flows: deps.flows,
    users: deps.users,
    auditLogger: deps.auditLogger,
  };
  const startUnattendedRun = new StartUnattendedRun({
    users: deps.users,
    flows: deps.flows,
    flowVersions: deps.flowVersions,
    startSession: new StartSession(deps.sessions, deps.flows, deps.flowNodes, deps.flowEdges, deps.flowVersions),
    sessions: deps.sessions,
  });

  const listTriggerRuns = new ListTriggerRuns({ runs: unattendedRuns, graph, approvals: deps.approvals });

  // 60 calls a minute per flow, with a burst of 60 (ADR-064 §3). Per instance,
  // like the chat and auth limiters, until a shared store exists.
  const webhookRateLimiter = new InMemoryRateLimiter({ capacity: 60, refillPerSecond: 1 }, 10_000, new SystemClock());

  return {
    services: { webhookRateLimiter, outboundHttp },
    repos: { flowTriggers, unattendedRuns, eventWatches },
    useCases: {
      runAiTaskNode: new RunAiTaskNode(
        deps.languageModel,
        deps.sessionMessages,
        deps.sessionStepOutputs,
        deps.approvals,
        deps.confirmAndSend,
        deps.reportingLineResolver,
      ),
      runEmailNode: new RunEmailNode({
        users: deps.users,
        groups: deps.groups,
        sessionStepOutputs: deps.sessionStepOutputs,
        sessionMessages: deps.sessionMessages,
        objectStorage: deps.objectStorage,
        emailSender: deps.emailSender,
        auditLogger: deps.auditLogger,
        loadAutomationConfig: deps.loadAutomationConfig,
      }),
      notifyUnattendedIncident: new NotifyUnattendedIncident(
        deps.notificationLog,
        deps.emailSender,
        deps.users,
        deps.auditLogger,
        deps.notificationConfig,
      ),
      startUnattendedRun,
      listTriggerRuns,
      listEventWatches: new ListEventWatches({ watches: eventWatches, runs: listTriggerRuns }),
      countWatchesNeedingAttention: new CountWatchesNeedingAttention({ watches: eventWatches, runs: unattendedRuns }),
      createEventWatch: new CreateEventWatch(saveWatchDependencies),
      updateEventWatch: new UpdateEventWatch(saveWatchDependencies),
      deleteEventWatch: new DeleteEventWatch(watchLifecycleDependencies),
      pauseEventWatch: new PauseEventWatch(watchLifecycleDependencies),
      resumeEventWatch: new ResumeEventWatch(watchLifecycleDependencies),
      testEventWatch: new TestEventWatch({
        watches: eventWatches,
        http: outboundHttp,
        loadAutomationConfig: deps.loadAutomationConfig,
        auditLogger: deps.auditLogger,
      }),
      previewEventWatch: new PreviewEventWatch(),
      configureWebhookTrigger: new ConfigureWebhookTrigger(webhookDependencies),
      rotateWebhookToken: new RotateWebhookToken(webhookDependencies),
      setWebhookHmac: new SetWebhookHmac(webhookDependencies),
      setTriggerInputs: new SetTriggerInputs(deps.flows),
      startFlowFromWebhook: new StartFlowFromWebhook({
        triggers: flowTriggers,
        crypto: nodeWebhookCrypto,
        startUnattendedRun,
        auditLogger: deps.auditLogger,
        now: () => new Date(),
      }),
    },
  };
};
