/**
 * The fork and step-confirmation seed fixtures, kept beside the main seed rather
 * than in it: neither is about approvals or extraction, and together they were
 * what pushed e2e-fixtures.ts past the source-size ceiling.
 *
 * Both go through the use cases like the rest of the seed, so nothing here
 * touches the ORM.
 */

import type { Container } from "./container";
import { unwrap } from "./e2e-fixtures";

const SEED_FORK_FLOW_NAME = "E2E SEED Fork Flow";
const SEED_CONFIRM_FLOW_NAME = "E2E SEED Confirmation Flow";
const SEED_CONFIRM_SESSION_TITLE = "E2E SEED Confirmation Session";

// A fork flow whose two mutually-exclusive branches capture the same `amount`
// field. Flow Insights collapses both branch columns into one by default; the
// "Combine forked steps" toggle splits them back. Drives the
// enhance-fork-field-consolidation e2e spec.
export const seedForkFlow = async (container: Container, ownerUserId: string): Promise<string> => {
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_FORK_FLOW_NAME,
      description: "Seeded procurement flow that forks into two approval branches",
      expertRole: "Procurement Officer",
      ownerUserId,
    }),
    "create fork flow",
  );

  const branchNode = async (name: string, positionX: number) =>
    unwrap(
      await container.useCases.createFlowNode.execute({
        flowId: flow.id,
        type: "conversational",
        name,
        positionX,
        positionY: 240,
        config: {
          aiInstruction: "Capture the amount of the purchase.",
          doneWhen: "The amount is confirmed.",
          outputType: "conversation_only",
        },
      }),
      `create ${name} node`,
    );

  const intakeNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Request Intake",
      positionX: 120,
      positionY: 120,
      config: {
        aiInstruction: "Open the procurement request.",
        doneWhen: "The request is opened.",
        outputType: "conversation_only",
      },
    }),
    "create intake node",
  );

  const standardNode = await branchNode("Standard Purchase", 320);
  const approvalNode = await branchNode("Procurement Approval", 520);

  const saveNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Save document",
      positionX: 420,
      positionY: 360,
      config: {
        aiInstruction: "Save the procurement document.",
        doneWhen: "The document is saved.",
        outputType: "conversation_only",
      },
    }),
    "create save node",
  );

  const forkEdges: [string, string][] = [
    [intakeNode.id, standardNode.id],
    [intakeNode.id, approvalNode.id],
    [standardNode.id, saveNode.id],
    [approvalNode.id, saveNode.id],
  ];
  for (const [fromNodeId, toNodeId] of forkEdges) {
    unwrap(
      await container.useCases.createFlowEdge.execute({ flowId: flow.id, fromNodeId, toNodeId }),
      "create fork edge",
    );
  }

  unwrap(
    await container.useCases.updateFlow.execute(
      flow.id,
      { status: "published", visibility: { kind: "global" } },
      { canPublishToEveryone: true },
    ),
    "publish fork flow",
  );

  // One session per branch, each capturing `amount` on its own branch node.
  const branchCaptures: [string, string][] = [
    [standardNode.id, "$1,500"],
    [approvalNode.id, "$2,750"],
  ];
  for (const [nodeId, value] of branchCaptures) {
    const branchSession = unwrap(
      await container.useCases.startSession.execute({ flowId: flow.id, userId: ownerUserId }),
      "start fork session",
    );
    unwrap(
      await container.repos.sessionStepOutputs.create({
        sessionId: branchSession.id,
        flowId: flow.id,
        nodeId,
        fields: [{ key: "amount", label: "Amount", type: "currency", value }],
      }),
      "create fork step output",
    );
  }

  return flow.id;
};

// A two-step conversational flow whose first step has `requireConfirmation` on.
// The seeded session has reached the step's threshold and is parked in the
// awaiting-confirmation state, so the ConfirmStepCard renders deterministically
// without driving a live AI turn. Drives the step-confirmation-toggle e2e spec.
export const seedConfirmationSession = async (
  container: Container,
  ownerUserId: string,
): Promise<string> => {
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_CONFIRM_FLOW_NAME,
      description: "Seeded flow whose first step requires operator confirmation",
      expertRole: "Onboarding Expert",
      ownerUserId,
    }),
    "create confirmation flow",
  );

  const confirmNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Confirm requester details",
      positionX: 120,
      positionY: 120,
      config: {
        aiInstruction: "Collect the requester's name and organisation.",
        doneWhen: "Name and organisation are confirmed.",
        outputType: "conversation_only",
        requireConfirmation: true,
      },
    }),
    "create confirm node",
  );

  const nextNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Plan next steps",
      positionX: 420,
      positionY: 120,
      config: {
        aiInstruction: "Plan the onboarding next steps.",
        doneWhen: "The plan is agreed.",
        outputType: "conversation_only",
      },
    }),
    "create confirm next node",
  );

  unwrap(
    await container.useCases.createFlowEdge.execute({
      flowId: flow.id,
      fromNodeId: confirmNode.id,
      toNodeId: nextNode.id,
    }),
    "create confirm edge",
  );

  unwrap(
    await container.useCases.updateFlow.execute(
      flow.id,
      { status: "published", visibility: { kind: "global" } },
      { canPublishToEveryone: true },
    ),
    "publish confirmation flow",
  );

  const session = unwrap(
    await container.useCases.startSession.execute({ flowId: flow.id, userId: ownerUserId }),
    "start confirmation session",
  );

  unwrap(
    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "assistant",
      content: "Thanks — I have your name and organisation. Proceed when you're ready.",
      confidence: 95,
      stepNodeId: confirmNode.id,
      aiPayload: {
        response: "Thanks — I have your name and organisation. Proceed when you're ready.",
        rationale: "Details gathered; the step is complete but held for operator confirmation.",
        stepCompleteConfidence: 95,
        contextGathered: [
          { key: "Name", value: "Jane Smith" },
          { key: "Organisation", value: "Acme Ltd" },
        ],
      },
    }),
    "create confirmation assistant message",
  );

  unwrap(
    await container.repos.sessions.update(session.id, {
      title: SEED_CONFIRM_SESSION_TITLE,
      awaitingConfirmationNodeId: confirmNode.id,
    }),
    "park confirmation session in awaiting state",
  );

  return session.id;
};
