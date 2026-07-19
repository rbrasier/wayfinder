import type {
  Flow,
  FlowNode,
  ResolvedDocumentGenerationBudget,
  Session,
  SessionMessage,
} from "@rbrasier/domain";
import type { DocumentData } from "@rbrasier/shared";
import type { getContainer } from "@/lib/container";

type Container = ReturnType<typeof getContainer>;

export interface CaptureStructuredRecordInput {
  container: Container;
  milestoneId: string;
  session: Session;
  flow: Flow;
  messages: SessionMessage[];
  node: FlowNode;
  // Field values already extracted by the pre-generation gate on a pass, so the
  // capture skips a redundant second extraction.
  precomputedFieldValues?: DocumentData;
}

// Persists a completed structured step's captured fields as a SessionStepOutput
// (ADR-038 §3) — the record card reads it. Best-effort: a failure is logged but
// must not break the advance, mirroring the document-generation path.
export async function captureStructuredRecord(input: CaptureStructuredRecordInput): Promise<void> {
  const { container, milestoneId, session, flow, messages, node, precomputedFieldValues } = input;
  try {
    let budget: ResolvedDocumentGenerationBudget | undefined;
    try {
      budget = await container.runtimeConfig.resolveDocumentGenerationBudget();
    } catch {
      budget = undefined;
    }

    const result = await container.useCases.captureStructuredStepOutput.execute({
      sessionId: session.id,
      flowId: flow.id,
      node,
      messageId: milestoneId,
      contextDocs: flow.contextDocs,
      messages,
      budget,
      fieldValues: precomputedFieldValues,
    });
    if (result.error) {
      await container.services.errorLogger.log({
        level: "error",
        message: `Structured record capture failed: ${result.error.message}`,
        stack: result.error.cause instanceof Error ? result.error.cause.stack ?? null : null,
        page: `api/chat/${session.id}/stream`,
        metadata: { sessionId: session.id, nodeId: node.id, errorCode: result.error.code },
      });
    }
  } catch (cause) {
    await container.services.errorLogger.log({
      level: "error",
      message: "Structured record capture threw",
      stack: cause instanceof Error ? cause.stack ?? null : null,
      page: `api/chat/${session.id}/stream`,
      metadata: { sessionId: session.id, nodeId: node.id },
    });
  }
}
