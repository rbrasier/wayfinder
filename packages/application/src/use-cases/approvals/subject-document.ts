import type {
  ConversationalNodeConfig,
  IApprovalRepository,
  IFlowNodeRepository,
  IObjectStorage,
  ISessionMessageRepository,
  ISessionStepOutputRepository,
  SessionDocument,
  TemplateField,
} from "@wayfinder/domain";
import type { DocumentData } from "@wayfinder/shared";
import { approvalOwnedForStep } from "./approval-values";

export interface SubjectDocumentDeps {
  approvals: IApprovalRepository;
  flowNodes: IFlowNodeRepository;
  sessionMessages: ISessionMessageRepository;
  sessionStepOutputs: ISessionStepOutputRepository;
  objectStorage: IObjectStorage;
}

// The document an approval signs, ready to re-render: the latest generated
// message for the subject step, its template and fields. Shared by the
// re-render on decision (ADR-043 §6) and the freeze before a certificate
// signature (ADR-068 §1), so both render exactly the same document.
export interface SubjectDocument {
  messageId: string;
  document: SessionDocument;
  config: ConversationalNodeConfig;
  fields: TemplateField[];
  templateBytes: Buffer;
}

export const loadSubjectDocument = async (
  deps: SubjectDocumentDeps,
  sessionId: string,
  subjectNodeId: string,
): Promise<SubjectDocument | null> => {
  const node = await deps.flowNodes.findById(subjectNodeId);
  if (node.error) return null;
  const config = (node.data?.config ?? {}) as unknown as ConversationalNodeConfig;
  if (!config.documentTemplatePath) return null;

  const messages = await deps.sessionMessages.listBySession(sessionId);
  if (messages.error) return null;
  const latest = messages.data
    .filter((message) => message.stepNodeId === subjectNodeId && message.document)
    .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())[0];
  if (!latest?.document) return null;

  const template = await deps.objectStorage.get(config.documentTemplatePath);
  if (template.error) return null;

  return {
    messageId: latest.id,
    document: latest.document,
    config,
    fields: config.documentTemplateFields ?? [],
    templateBytes: template.data,
  };
};

// The gathered values plus every decided approval's frozen attestation, comment
// and drawing, so approvals may decide in any order and each fills only its
// own slot.
export const subjectRenderValues = async (
  deps: SubjectDocumentDeps,
  sessionId: string,
  subjectNodeId: string,
  subject: SubjectDocument,
): Promise<{ values: DocumentData; imagePaths: Record<string, string> }> => {
  const values: DocumentData = {};
  const stepOutput = await deps.sessionStepOutputs.findByMessageId(subject.messageId);
  if (!stepOutput.error && stepOutput.data) {
    for (const field of stepOutput.data.fields) {
      values[field.key] = field.items ?? field.value;
    }
  }
  const owned = await approvalOwnedForStep(deps.approvals, sessionId, subjectNodeId, subject.fields);
  return { values: { ...values, ...owned.values }, imagePaths: owned.imagePaths };
};
