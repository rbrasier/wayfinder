import {
  ApplyApprovalSignature,
  ApproverEditSubjectFields,
  ConfirmAndSend,
  DecideApproval,
  ListApprovals,
  ListApprovalsWithContext,
  LoadPendingApproval,
  RecordOffSystemApproval,
  ResolveApprovalSubject,
  ReassignApproval,
  ResolveDecisionNotifyTargets,
  SuggestApprover,
  WithdrawApproval,
  type UpdateDocumentFields,
} from "@rbrasier/application";
import type {
  IApprovalRepository,
  IAuditLogger,
  IClock,
  IDocumentChunkRepository,
  IDocumentGenerator,
  IEmbeddingsProvider,
  IFlowEdgeRepository,
  IFlowNodeRepository,
  ILanguageModel,
  IObjectStorage,
  IReportingLineResolver,
  ISessionMessageRepository,
  ISessionParticipantRepository,
  ISessionRepository,
  ISessionStepOutputRepository,
  IUnitOfWork,
  IUserRepository,
  Sha256Hex,
} from "@rbrasier/domain";

export interface ApprovalUseCaseDeps {
  unitOfWork: IUnitOfWork;
  approvals: IApprovalRepository;
  sessions: ISessionRepository;
  sessionParticipants: ISessionParticipantRepository;
  sessionMessages: ISessionMessageRepository;
  sessionStepOutputs: ISessionStepOutputRepository;
  flowNodes: IFlowNodeRepository;
  flowEdges: IFlowEdgeRepository;
  users: IUserRepository;
  auditLogger: IAuditLogger;
  languageModel: ILanguageModel;
  documentGenerator: IDocumentGenerator;
  objectStorage: IObjectStorage;
  reportingLineResolver: IReportingLineResolver;
  embeddings: IEmbeddingsProvider;
  documentChunks: IDocumentChunkRepository;
  sha256Hex: Sha256Hex;
  clock: IClock;
  updateDocumentFields: UpdateDocumentFields;
  notifyOnApprovalRequested: ConstructorParameters<typeof ConfirmAndSend>[2];
  notifyOnApprovalDecided: ConstructorParameters<typeof DecideApproval>[6];
  notifyOnApprovalWithdrawn: ConstructorParameters<typeof WithdrawApproval>[8];
  notifyOnApprovalReassigned: ConstructorParameters<typeof ReassignApproval>[5];
}

// The approval use-case cluster, factored out of the main container to keep
// container.ts under the source-size ceiling. Spread into the container's
// `useCases` map; behaviour and wiring are unchanged.
export const buildApprovalUseCases = (deps: ApprovalUseCaseDeps) => {
  // Shared, not constructed twice: the gate and the approver's context must
  // resolve the subject the same way or they drift apart (ADR-040 §2).
  const resolveApprovalSubject = new ResolveApprovalSubject(
    deps.approvals,
    deps.flowNodes,
    deps.sessionStepOutputs,
    deps.sessionMessages,
    deps.languageModel,
  );

  const applyApprovalSignature = new ApplyApprovalSignature(
    deps.approvals,
    deps.flowNodes,
    deps.sessionMessages,
    deps.sessionStepOutputs,
    deps.documentGenerator,
    deps.objectStorage,
  );

  // Shared with the off-system path, which delegates the decision itself rather
  // than duplicating the commit, advance, projection, signature and
  // notification (ADR-055 §2).
  const decideApproval = new DecideApproval(
    deps.unitOfWork,
    deps.approvals,
    deps.sessions,
    deps.flowEdges,
    deps.sessionStepOutputs,
    deps.auditLogger,
    deps.notifyOnApprovalDecided,
    deps.sessionMessages,
    deps.users,
    deps.flowNodes,
    deps.sha256Hex,
    resolveApprovalSubject,
    applyApprovalSignature,
  );

  return {
    resolveApprovalSubject,
    applyApprovalSignature,
    decideApproval,
    recordOffSystemApproval: new RecordOffSystemApproval(
      deps.approvals,
      deps.sessions,
      deps.flowNodes,
      deps.objectStorage,
      deps.auditLogger,
      decideApproval,
      deps.clock,
    ),
    approverEditSubjectFields: new ApproverEditSubjectFields(
      deps.approvals,
      deps.users,
      deps.sessionMessages,
      deps.updateDocumentFields,
      deps.flowNodes,
    ),
    suggestApprover: new SuggestApprover(
      deps.approvals,
      deps.flowNodes,
      deps.reportingLineResolver,
      deps.users,
      deps.sessions,
      deps.embeddings,
      deps.documentChunks,
      deps.languageModel,
    ),
    confirmAndSend: new ConfirmAndSend(
      deps.approvals,
      deps.auditLogger,
      deps.notifyOnApprovalRequested,
    ),
    withdrawApproval: new WithdrawApproval(
      deps.unitOfWork,
      deps.approvals,
      deps.sessions,
      deps.sessionStepOutputs,
      deps.auditLogger,
      deps.sessionMessages,
      deps.users,
      deps.flowNodes,
      deps.notifyOnApprovalWithdrawn,
    ),
    reassignApproval: new ReassignApproval(
      deps.approvals,
      deps.sessions,
      deps.auditLogger,
      deps.sessionMessages,
      deps.users,
      deps.notifyOnApprovalReassigned,
      deps.notifyOnApprovalRequested,
    ),
    loadPendingApproval: new LoadPendingApproval(deps.approvals, deps.users),
    listApprovals: new ListApprovals(deps.approvals),
    listApprovalsWithContext: new ListApprovalsWithContext(
      deps.approvals,
      deps.sessions,
      deps.users,
      deps.sessionMessages,
      deps.sessionStepOutputs,
      deps.flowNodes,
      resolveApprovalSubject,
    ),
    resolveDecisionNotifyTargets: new ResolveDecisionNotifyTargets(
      deps.sessions,
      deps.sessionParticipants,
      deps.users,
      deps.flowNodes,
      deps.approvals,
    ),
  };
};
