// The seed fixture for document signatures (ADR-067): a pending approval that
// claims a signature slot on a real .docx and converts the signed document to
// PDF, with the install pointed at the mocks server's Gotenberg stand-in.

import { buildMinimalDocx } from "@wayfinder/adapters";
import { DEFAULT_SIGNATURE_CONFIG, SIGNATURE_CONFIG_SETTING_KEY } from "@wayfinder/domain";
import type { Container } from "./container";
import { unwrap } from "./e2e-fixtures";

const SEED_SIGNING_FLOW_NAME = "E2E SEED Signing Flow";
const SEED_SIGNING_SESSION_TITLE = "E2E SEED Signing Session";
const TEMPLATE_PATH = "templates/e2e-seed-signing.docx";
const DOCUMENT_PATH = "context/e2e-seed/signing-instrument.docx";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// The e2e workflow starts the shared mocks server here (e2e.yml). Attestation
// stays the method, so no other seeded approval starts asking for a drawing or
// a certificate; only the converter is set.
const MOCK_GOTENBERG_URL = "http://localhost:4001/gotenberg";

export const seedSigningSession = async (
  container: Container,
  ownerUserId: string,
): Promise<{ sessionId: string }> => {
  const saved = await container.repos.systemSettings.set(
    SIGNATURE_CONFIG_SETTING_KEY,
    JSON.stringify({ ...DEFAULT_SIGNATURE_CONFIG, gotenbergUrl: MOCK_GOTENBERG_URL }),
  );
  if (saved.error) throw new Error(`seed signature config: ${saved.error.message}`);
  container.runtimeConfig.invalidateSignature();

  const template = buildMinimalDocx([
    "Delegation of purchasing authority to {{Delegate Name}}.",
    "{{ Delegate Signature (approval) }}",
  ]);
  for (const path of [TEMPLATE_PATH, DOCUMENT_PATH]) {
    const stored = await container.objectStorage.put(path, template, DOCX_MIME);
    if (stored.error) throw new Error(`seed signing template ${path}: ${stored.error.message}`);
  }

  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_SIGNING_FLOW_NAME,
      description: "Seeded flow whose approval signs a document and converts it to PDF",
      expertRole: "Delegation Officer",
      ownerUserId,
    }),
    "create signing flow",
  );

  const documentNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Prepare instrument",
      positionX: 120,
      positionY: 120,
      config: {
        aiInstruction: "Draft the delegation instrument.",
        doneWhen: "The instrument is drafted.",
        outputType: "generate_document",
        documentTemplatePath: TEMPLATE_PATH,
        documentTemplateFields: [
          { key: "delegate_name", label: "Delegate Name", type: "text", optional: false, raw: "Delegate Name" },
          {
            key: "delegate_signature",
            label: "Delegate Signature",
            type: "signature",
            optional: true,
            raw: "Delegate Signature (approval)",
          },
        ],
      },
    }),
    "create signing document node",
  );

  const approvalNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "approval",
      name: "Delegate sign-off",
      positionX: 420,
      positionY: 120,
      config: {
        approverSource: "first_level_supervisor",
        approvalSubject: { kind: "step", nodeId: documentNode.id },
        signatureFieldKey: "delegate_signature",
        convertToPdfOnSigning: true,
      },
    }),
    "create signing approval node",
  );

  unwrap(
    await container.useCases.createFlowEdge.execute({
      flowId: flow.id,
      fromNodeId: documentNode.id,
      toNodeId: approvalNode.id,
    }),
    "create signing flow edge",
  );
  unwrap(
    await container.useCases.updateFlow.execute(
      flow.id,
      { status: "published", visibility: { kind: "global" } },
      { canPublishToEveryone: true },
    ),
    "publish signing flow",
  );

  const session = unwrap(
    await container.useCases.startSession.execute({ flowId: flow.id, userId: ownerUserId }),
    "start signing session",
  );
  const documentMessage = unwrap(
    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "assistant",
      content: "Here is the delegation instrument.",
      confidence: 95,
      stepNodeId: documentNode.id,
      document: {
        filename: "signing-instrument.docx",
        storagePath: DOCUMENT_PATH,
        summary: "Delegation of purchasing authority to Acme Ltd.",
        generatedAt: new Date().toISOString(),
      },
      documentStatus: "complete",
    }),
    "create signing document message",
  );
  unwrap(
    await container.repos.sessionStepOutputs.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: documentNode.id,
      messageId: documentMessage.id,
      fields: [{ key: "delegate_name", label: "Delegate Name", type: "text", value: "Acme Ltd" }],
    }),
    "create signing step output",
  );
  unwrap(
    await container.repos.sessions.update(session.id, {
      title: SEED_SIGNING_SESSION_TITLE,
      currentNodeId: approvalNode.id,
      graphCheckpoint: { currentNodeId: approvalNode.id, advancedFrom: documentNode.id },
    }),
    "park signing session on the approval",
  );
  unwrap(
    await container.repos.approvals.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: approvalNode.id,
      requestedByUserId: ownerUserId,
      approverSource: "first_level_supervisor",
      approverUserId: ownerUserId,
      status: "pending",
    }),
    "create pending signing approval",
  );

  return { sessionId: session.id };
};
