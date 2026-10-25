import type { Flow, FlowNode, Session, SessionMessage } from "@wayfinder/domain";
import type { getContainer } from "@/lib/container";

type Container = ReturnType<typeof getContainer>;

export async function isScheduledNodeEnabled(
  container: Container,
  userId: string,
  isAdmin: boolean,
): Promise<boolean> {
  const flag = await container.useCases.isFeatureEnabledForUser.execute(
    userId,
    "scheduled_node",
    isAdmin,
  );
  return !flag.error && flag.data === true;
}

// Flatten the context gathered across the conversation into a key/value map so a
// scheduled node can anchor its fire time to an earlier step's metadata.
const buildSessionMetadata = (messages: SessionMessage[]): Record<string, string> => {
  const metadata: Record<string, string> = {};
  for (const message of messages) {
    if (message.role !== "assistant" || !message.aiPayload) continue;
    for (const item of message.aiPayload.contextGathered) {
      metadata[item.key] = item.value;
    }
  }
  return metadata;
};

const buildScheduleTranscript = (messages: SessionMessage[]): string =>
  messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n\n")
    .slice(0, 8000);

export interface DispatchScheduledNodeInput {
  container: Container;
  session: Session;
  flow: Flow;
  node: FlowNode;
  messages: SessionMessage[];
}

// Reaching a scheduled node creates an active schedule row and pauses the
// session (no initial message is generated). The worker resumes it when due.
export async function dispatchScheduledNode(input: DispatchScheduledNodeInput): Promise<void> {
  const { container, session, flow, node, messages } = input;
  try {
    const metadata = buildSessionMetadata(messages);
    const priorOutputs = await container.repos.sessionStepOutputs.listBySession(session.id);
    const result = await container.useCases.scheduleNodeEvent.execute({
      session,
      node,
      metadata,
      priorStepOutputs: priorOutputs.error ? [] : priorOutputs.data,
      insights: Object.entries(metadata).map(([key, value]) => ({ key, value })),
      transcript: buildScheduleTranscript(messages),
      contextDocs: flow.contextDocs,
    });

    let content: string;
    if (result.error) {
      content = `This scheduled step (${node.name}) could not be scheduled: ${result.error.message}`;
    } else if (result.data.status === "failed") {
      const reason =
        typeof result.data.payload.reason === "string" ? result.data.payload.reason : "unknown reason";
      content = `Scheduled step "${node.name}" could not start: ${reason}`;
    } else {
      content = `Scheduled step: ${node.name}. Next: ${result.data.nextFireAt.toISOString()}.`;
    }

    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "system",
      content,
      stepNodeId: node.id,
    });

    if (result.error) {
      await container.services.errorLogger.log({
        level: "error",
        message: `Scheduled node dispatch failed: ${result.error.message}`,
        stack: result.error.cause instanceof Error ? result.error.cause.stack ?? null : null,
        page: `api/chat/${session.id}/stream`,
        metadata: { sessionId: session.id, nodeId: node.id, errorCode: result.error.code },
      });
    }
  } catch (cause) {
    await container.services.errorLogger.log({
      level: "error",
      message: "Scheduled node dispatch threw",
      stack: cause instanceof Error ? cause.stack ?? null : null,
      page: `api/chat/${session.id}/stream`,
      metadata: { sessionId: session.id, nodeId: node.id },
    });
  }
}
