import type { Container } from "./container";
import { unwrap } from "./e2e-fixtures";

const SEED_STRUCTURED_FLOW_NAME = "E2E SEED Structured Flow";
const SEED_STRUCTURED_SESSION_TITLE = "E2E SEED Structured Session";

// A two-step flow whose first step is a Structured conversation (ADR-038): it
// declares fields directly and produces no document. The seeded session has
// completed that step (advanced to the second, still-active step) with a
// milestone assistant turn and a captured SessionStepOutput — so the RecordCard
// renders its captured values deterministically and stays editable, without
// driving a live AI turn. Drives the structured-conversation e2e spec.
export const seedStructuredSession = async (
  container: Container,
  ownerUserId: string,
): Promise<{ sessionId: string; flowId: string }> => {
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_STRUCTURED_FLOW_NAME,
      description: "Seeded flow whose first step captures a structured record",
      expertRole: "Intake Officer",
      ownerUserId,
    }),
    "create structured flow",
  );

  const structuredNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Record intake decision",
      positionX: 120,
      positionY: 120,
      config: {
        aiInstruction: "Capture the intake decision and its owner.",
        doneWhen: "__TEMPLATE_COMPLETE__",
        outputType: "structured",
        allowManualEdit: true,
        structuredFields: [
          { key: "decision", label: "Decision", type: "text", optional: false, raw: "Decision (text)" },
          { key: "owner", label: "Owner", type: "email", optional: false, raw: "Owner (email)" },
        ],
      },
    }),
    "create structured node",
  );

  const nextNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Confirm next steps",
      positionX: 420,
      positionY: 120,
      config: {
        aiInstruction: "Agree the next steps for the intake.",
        doneWhen: "The next steps are agreed.",
        outputType: "unstructured",
      },
    }),
    "create structured next node",
  );

  unwrap(
    await container.useCases.createFlowEdge.execute({
      flowId: flow.id,
      fromNodeId: structuredNode.id,
      toNodeId: nextNode.id,
    }),
    "create structured edge",
  );

  unwrap(
    await container.useCases.updateFlow.execute(
      flow.id,
      { status: "published", visibility: { kind: "global" } },
      { canPublishToEveryone: true },
    ),
    "publish structured flow",
  );

  const session = unwrap(
    await container.useCases.startSession.execute({ flowId: flow.id, userId: ownerUserId }),
    "start structured session",
  );

  // High-confidence advancing turn on the structured step. It is a completed
  // milestone because the session has since moved to the next node (below), so
  // stepNodeId !== currentNodeId.
  const recordMessage = unwrap(
    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "assistant",
      content: "Recorded the intake decision and its owner.",
      confidence: 95,
      stepNodeId: structuredNode.id,
      aiPayload: {
        response: "Recorded the intake decision and its owner.",
        rationale: "Both declared fields were captured to confidence.",
        stepCompleteConfidence: 95,
        contextGathered: [
          { key: "Decision", value: "Approved" },
          { key: "Owner", value: "alex@acme.com" },
        ],
      },
    }),
    "create structured record message",
  );

  unwrap(
    await container.repos.sessionStepOutputs.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: structuredNode.id,
      messageId: recordMessage.id,
      fields: [
        { key: "decision", label: "Decision", type: "text", value: "Approved" },
        { key: "owner", label: "Owner", type: "email", value: "alex@acme.com" },
      ],
    }),
    "create structured step output",
  );

  unwrap(
    await container.repos.sessions.update(session.id, {
      title: SEED_STRUCTURED_SESSION_TITLE,
      currentNodeId: nextNode.id,
    }),
    "advance structured session to the next step",
  );

  return { sessionId: session.id, flowId: flow.id };
};
