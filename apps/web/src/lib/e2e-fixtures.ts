import type { Result } from "@rbrasier/domain";
import { schema } from "@rbrasier/adapters";
import { eq, inArray } from "drizzle-orm";
import type { Container } from "./container";

// Deterministic fixture data seeded before the E2E suite so that specs gated on
// "a session/flow must exist" run their real assertions instead of skipping.
// Everything created here is removed by `teardownE2EFixtures`, which clears the
// whole E2E database (seed + anything the specs themselves created).

const SEED_FLOW_NAME = "E2E SEED Onboarding Flow";
const SEED_SESSION_TITLE = "E2E SEED Session";
const SEED_FORK_FLOW_NAME = "E2E SEED Fork Flow";

const unwrap = <T>(result: Result<T>, context: string): T => {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  return result.data;
};

const resolveAdminUserId = async (container: Container): Promise<string> => {
  const email =
    process.env.TEST_ADMIN_EMAIL || process.env.ADMIN_SEED_EMAIL || "admin@example.com";

  const existing = unwrap(await container.repos.users.findByEmail(email), "find admin user");
  if (existing) return existing.id;

  const created = unwrap(
    await container.repos.users.create({ email, isAdmin: true }),
    "create admin user",
  );
  return created.id;
};

export interface SeedResult {
  flowId: string;
  sessionId: string;
  forkFlowId: string;
}

// A fork flow whose two mutually-exclusive branches capture the same `amount`
// field. Flow Insights collapses both branch columns into one by default; the
// "Combine forked steps" toggle splits them back. Drives the
// enhance-fork-field-consolidation e2e spec.
const seedForkFlow = async (container: Container, ownerUserId: string): Promise<string> => {
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

export const seedE2EFixtures = async (container: Container): Promise<SeedResult> => {
  const ownerUserId = await resolveAdminUserId(container);

  // ── Rich flow: a conversational step plus a document-generation step ──────
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_FLOW_NAME,
      description: "Seeded onboarding flow with a document-generation step",
      expertRole: "Onboarding Expert",
      ownerUserId,
    }),
    "create seed flow",
  );

  const gatherNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Gather requester details",
      positionX: 120,
      positionY: 120,
      config: {
        aiInstruction: "Collect the requester's name and organisation.",
        doneWhen: "Name and organisation are confirmed.",
        outputType: "conversation_only",
      },
    }),
    "create gather node",
  );

  const documentNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Draft onboarding plan",
      positionX: 420,
      positionY: 120,
      config: {
        aiInstruction: "Draft an onboarding plan from the gathered details.",
        doneWhen: "The onboarding plan is generated.",
        outputType: "generate_document",
        documentTemplatePath: "templates/e2e-seed-onboarding.docx",
        documentTemplateContent: "Onboarding plan for {{Name}} at {{Organisation}}.",
      },
    }),
    "create document node",
  );

  unwrap(
    await container.useCases.createFlowEdge.execute({
      flowId: flow.id,
      fromNodeId: gatherNode.id,
      toNodeId: documentNode.id,
    }),
    "create edge",
  );

  unwrap(
    await container.useCases.updateFlow.execute(
      flow.id,
      { status: "published", visibility: { kind: "global" } },
      { canPublishToEveryone: true },
    ),
    "publish seed flow",
  );

  const session = unwrap(
    await container.useCases.startSession.execute({ flowId: flow.id, userId: ownerUserId }),
    "start seed session",
  );

  unwrap(
    await container.repos.sessions.update(session.id, { title: SEED_SESSION_TITLE }),
    "set seed session title",
  );

  // ── Conversation history across both steps ────────────────────────────────
  unwrap(
    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "user",
      content: "My name is Jane Smith and I work at Acme Ltd.",
      senderUserId: ownerUserId,
      stepNodeId: gatherNode.id,
    }),
    "create user message 1",
  );

  // Assistant turn with a persisted aiPayload → renders the "Show AI reasoning"
  // affordance the transparency spec looks for. Confidence < 90 so it does not
  // advance the step.
  unwrap(
    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "assistant",
      content: "Thanks Jane — I've noted Acme Ltd. Let's draft your onboarding plan.",
      confidence: 82,
      stepNodeId: gatherNode.id,
      aiPayload: {
        response: "Thanks Jane — I've noted Acme Ltd. Let's draft your onboarding plan.",
        rationale: "Name and organisation gathered; ready to proceed to the document step.",
        stepCompleteConfidence: 82,
        contextGathered: [
          { key: "Name", value: "Jane Smith" },
          { key: "Organisation", value: "Acme Ltd" },
        ],
      },
    }),
    "create assistant message 1",
  );

  unwrap(
    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "user",
      content: "Please draft the onboarding plan document.",
      senderUserId: ownerUserId,
      stepNodeId: documentNode.id,
    }),
    "create user message 2",
  );

  // High-confidence advancing assistant turn carrying a generated document →
  // renders the DocumentCard (download/regenerate) and document-confidence
  // affordances. confidence >= 90 and no following message makes it advancing.
  const documentMessage = unwrap(
    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "assistant",
      content: "Here is the onboarding plan for Jane Smith at Acme Ltd.",
      confidence: 95,
      stepNodeId: documentNode.id,
      document: {
        filename: "onboarding-plan.docx",
        storagePath: "context/e2e-seed/onboarding-plan.docx",
        summary: "Onboarding plan covering accounts, equipment, and first-week schedule.",
        generatedAt: new Date().toISOString(),
      },
      documentStatus: "complete",
      aiPayload: {
        response: "Here is the onboarding plan for Jane Smith at Acme Ltd.",
        rationale: "All required details gathered; the onboarding plan was generated.",
        stepCompleteConfidence: 95,
        contextGathered: [
          { key: "Name", value: "Jane Smith" },
          { key: "Organisation", value: "Acme Ltd" },
        ],
        documentGenerationConfidence: {
          guidanceAlignmentConfidence: 93,
          guidanceAlignmentRationale: "The plan follows the standard onboarding structure.",
          criteriaAlignmentConfidence: 90,
          criteriaAlignmentRationale: "All completion criteria for the step are satisfied.",
        },
      },
    }),
    "create assistant document message",
  );

  unwrap(
    await container.repos.sessionStepOutputs.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: documentNode.id,
      messageId: documentMessage.id,
      fields: [
        { key: "name", label: "Name", type: "text", value: "Jane Smith" },
        { key: "organisation", label: "Organisation", type: "text", value: "Acme Ltd" },
      ],
    }),
    "create step output",
  );

  const forkFlowId = await seedForkFlow(container, ownerUserId);

  return { flowId: flow.id, sessionId: session.id, forkFlowId };
};

// Clears only the E2E admin user's flows and sessions — in foreign-key-safe
// order — leaving data owned by other users untouched. Auth users/sessions
// and system settings are never touched so re-runs work.
export const teardownE2EFixtures = async (container: Container): Promise<void> => {
  const { db } = container;

  const adminUserId = await resolveAdminUserId(container);

  const flowRows = await db
    .select({ id: schema.app_flows.id })
    .from(schema.app_flows)
    .where(eq(schema.app_flows.owner_user_id, adminUserId));
  const flowIds = flowRows.map((r) => r.id);

  const sessionRows = await db
    .select({ id: schema.app_sessions.id })
    .from(schema.app_sessions)
    .where(eq(schema.app_sessions.user_id, adminUserId));
  const sessionIds = sessionRows.map((r) => r.id);

  await db
    .delete(schema.app_notification_log)
    .where(eq(schema.app_notification_log.recipient_user_id, adminUserId));

  if (sessionIds.length > 0) {
    await db
      .delete(schema.app_session_schedule_runs)
      .where(inArray(schema.app_session_schedule_runs.session_id, sessionIds));
    await db
      .delete(schema.app_session_schedules)
      .where(inArray(schema.app_session_schedules.session_id, sessionIds));
    await db
      .delete(schema.app_session_step_outputs)
      .where(inArray(schema.app_session_step_outputs.session_id, sessionIds));
    await db
      .delete(schema.app_session_uploads)
      .where(inArray(schema.app_session_uploads.session_id, sessionIds));
    await db
      .delete(schema.app_session_typing)
      .where(inArray(schema.app_session_typing.session_id, sessionIds));
    await db
      .delete(schema.app_session_messages)
      .where(inArray(schema.app_session_messages.session_id, sessionIds));
    await db
      .delete(schema.kb_document_chunks)
      .where(inArray(schema.kb_document_chunks.session_id, sessionIds));
    await db.delete(schema.app_sessions).where(eq(schema.app_sessions.user_id, adminUserId));
  }

  if (flowIds.length > 0) {
    await db
      .delete(schema.kb_document_chunks)
      .where(inArray(schema.kb_document_chunks.flow_id, flowIds));
    await db
      .delete(schema.kb_context_doc_content)
      .where(inArray(schema.kb_context_doc_content.flow_id, flowIds));
    await db
      .delete(schema.app_flow_edges)
      .where(inArray(schema.app_flow_edges.flow_id, flowIds));
    await db
      .delete(schema.app_flow_nodes)
      .where(inArray(schema.app_flow_nodes.flow_id, flowIds));
    await db.delete(schema.app_flows).where(eq(schema.app_flows.owner_user_id, adminUserId));
  }
};
