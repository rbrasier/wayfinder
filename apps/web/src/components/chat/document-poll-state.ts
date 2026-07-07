// Pure decision for whether a document is still being generated somewhere in
// the session, which drives the fast client poll that resolves the spinner.
// Only the LAST assistant message per step can be generating: generation
// attaches to the most recent milestone message, and the pre-generation gate
// persists overruled replies that also carry high confidence and no document —
// counting those would poll forever.

export interface DocumentPollMessage {
  id: string;
  role: string;
  confidence: number | null;
  stepNodeId: string | null;
  documentStatus: string | null;
  document: object | null | undefined;
}

export interface DocumentPollNode {
  id: string;
  config: unknown;
}

export const hasPendingDocumentGeneration = (
  messages: readonly DocumentPollMessage[],
  currentNodeId: string | null,
  nodes: readonly DocumentPollNode[],
): boolean => {
  const lastAssistantByNode = new Map<string, DocumentPollMessage>();
  for (const message of messages) {
    if (message.role !== "assistant" || !message.stepNodeId) continue;
    lastAssistantByNode.set(message.stepNodeId, message);
  }

  for (const [stepNodeId, message] of lastAssistantByNode) {
    if ((message.confidence ?? 0) < 90) continue;
    if (stepNodeId === currentNodeId) continue;
    const node = nodes.find((candidate) => candidate.id === stepNodeId);
    const config = node?.config as Record<string, unknown> | undefined;
    if (config?.["outputType"] !== "generate_document") continue;
    if (!config?.["documentTemplatePath"]) continue;
    if (message.documentStatus === "complete" || message.documentStatus === "failed") continue;
    // A null status is treated as pending so legacy rows (created before
    // document_status existed) still poll until they resolve either way.
    if (!message.document) return true;
  }
  return false;
};
