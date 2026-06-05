import type { Result } from "@rbrasier/domain";
import { schema } from "@rbrasier/adapters";
import type { Container } from "./container";

// Deterministic fixture data seeded before the E2E suite so that specs gated on
// "a session/flow must exist" run their real assertions instead of skipping.
// Everything created here is removed by `teardownE2EFixtures`, which clears the
// whole E2E database (seed + anything the specs themselves created).

const SEED_FLOW_NAME = "E2E SEED Onboarding Flow";
const SEED_SESSION_TITLE = "E2E SEED Session";

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
}

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
      { isAdmin: true },
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

  return { flowId: flow.id, sessionId: session.id };
};

// Clears every flow/session row in the (dedicated) E2E database — the seed
// fixtures and anything the specs created — in foreign-key-safe order. Auth
// users/sessions and system settings are left intact so re-runs work.
export const teardownE2EFixtures = async (container: Container): Promise<void> => {
  const { db } = container;
  await db.delete(schema.app_session_schedule_runs);
  await db.delete(schema.app_session_schedules);
  await db.delete(schema.app_session_step_outputs);
  await db.delete(schema.app_session_uploads);
  await db.delete(schema.app_session_typing);
  await db.delete(schema.app_session_messages);
  await db.delete(schema.kb_document_chunks);
  await db.delete(schema.app_sessions);
  await db.delete(schema.kb_context_doc_content);
  await db.delete(schema.app_flow_edges);
  await db.delete(schema.app_flow_nodes);
  await db.delete(schema.app_flows);
};
