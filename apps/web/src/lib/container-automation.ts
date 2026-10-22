import { RunAiTaskNode, RunEmailNode, type ConfirmAndSend } from "@rbrasier/application";
import type {
  AutomationConfig,
  IApprovalRepository,
  IAuditLogger,
  IEmailSender,
  IGroupRepository,
  ILanguageModel,
  IObjectStorage,
  IReportingLineResolver,
  ISessionMessageRepository,
  ISessionStepOutputRepository,
  IUserRepository,
} from "@rbrasier/domain";

export interface AutomationDependencies {
  languageModel: ILanguageModel;
  sessionMessages: ISessionMessageRepository;
  sessionStepOutputs: ISessionStepOutputRepository;
  approvals: IApprovalRepository;
  confirmAndSend: ConfirmAndSend;
  reportingLineResolver: IReportingLineResolver;
  users: IUserRepository;
  groups: IGroupRepository;
  objectStorage: IObjectStorage;
  emailSender: IEmailSender;
  auditLogger: IAuditLogger;
  loadAutomationConfig: () => Promise<AutomationConfig>;
}

// The unattended-automation use cases (ADR-063–065), built outside container.ts
// so that file stays under the source-size ceiling.
export const buildAutomationUseCases = (deps: AutomationDependencies) => ({
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
});
