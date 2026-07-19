import {
  CaptureStructuredStepOutput,
  GenerateDocument,
  SummariseTemplate,
  UpdateDocumentFields,
  UpdateStructuredStepOutput,
} from "@rbrasier/application";
import type {
  IApprovalRepository,
  IAuditLogger,
  IDocumentGenerator,
  IFlowNodeRepository,
  ILanguageModel,
  IObjectStorage,
  ISessionMessageRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
} from "@rbrasier/domain";

export interface DocumentUseCaseDeps {
  documentGenerator: IDocumentGenerator;
  objectStorage: IObjectStorage;
  languageModel: ILanguageModel;
  sessionMessages: ISessionMessageRepository;
  sessionStepOutputs: ISessionStepOutputRepository;
  sessions: ISessionRepository;
  flowNodes: IFlowNodeRepository;
  approvals: IApprovalRepository;
  auditLogger: IAuditLogger;
}

// The document / structured-record use-case cluster, factored out of the main
// container to keep container.ts under the source-size ceiling. Spread into the
// container's `useCases` map; behaviour and wiring are unchanged.
export const buildDocumentUseCases = (deps: DocumentUseCaseDeps) => ({
  generateDocument: new GenerateDocument(
    deps.documentGenerator,
    deps.objectStorage,
    deps.languageModel,
    deps.sessionMessages,
    deps.sessionStepOutputs,
  ),
  captureStructuredStepOutput: new CaptureStructuredStepOutput(
    deps.languageModel,
    deps.sessionStepOutputs,
  ),
  updateDocumentFields: new UpdateDocumentFields(
    deps.documentGenerator,
    deps.objectStorage,
    deps.languageModel,
    deps.sessionMessages,
    deps.sessionStepOutputs,
    deps.sessions,
    deps.flowNodes,
    deps.approvals,
    deps.auditLogger,
  ),
  updateStructuredStepOutput: new UpdateStructuredStepOutput(
    deps.sessionMessages,
    deps.sessionStepOutputs,
    deps.sessions,
    deps.flowNodes,
    deps.approvals,
    deps.auditLogger,
  ),
  summariseTemplate: new SummariseTemplate(deps.languageModel),
});
