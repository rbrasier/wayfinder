// The seed fixtures for the approval-subject phase, kept beside the main seed
// rather than in it: two approvals signing one document is a large enough shape
// that inlining it pushed e2e-fixtures.ts past the source-size ceiling.

import type { Container } from "./container";
import { unwrap } from "./e2e-fixtures";

const SEED_SUBJECT_FLOW_NAME = "E2E SEED Approval Subject Flow";
const SEED_SUBJECT_SESSION_TITLE = "E2E SEED Approval Subject Session";
const SEED_SUBJECT_DOCUMENT = "delegation-instrument.docx";
const SEED_APPROVAL_FIRST_FLOW_NAME = "E2E SEED Approval First Flow";
const SEED_WITHDRAW_FLOW_NAME = "E2E SEED Approval Withdraw Flow";
const SEED_WITHDRAW_SESSION_TITLE = "E2E SEED Approval Withdraw Session";
const SEED_WITHDRAW_DRAFT_STEP = "Draft the request";
const SEED_WITHDRAW_REQUEST_MESSAGE =
  "Board meets Thursday — a signature before then would help.";
const SEED_SIGNATURE_WARNING_FLOW_NAME = "E2E SEED Signature Warning Flow";
const SEED_OFF_SYSTEM_FLOW_NAME = "E2E SEED Off-System Approval Flow";
const SEED_OFF_SYSTEM_SESSION_TITLE = "E2E SEED Off-System Approval Session";
const SEED_OFF_SYSTEM_NEXT_STEP = "Notify the supplier";

export const seedApprovalSubjectSession = async (
  container: Container,
  ownerUserId: string,
): Promise<{ sessionId: string; flowId: string }> => {
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_SUBJECT_FLOW_NAME,
      description: "Seeded flow with two approvals signing one document",
      expertRole: "Delegation Officer",
      ownerUserId,
    }),
    "create subject flow",
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
        documentTemplatePath: "templates/e2e-seed-instrument.docx",
        documentTemplateContent:
          "Delegation to {{Delegate Name}}.\n{{ Delegate Signature (approval) }}\n{{ Finance Signature (approval) }}",
        documentTemplateFields: [
          { key: "delegate_name", label: "Delegate Name", type: "text", optional: false, raw: "Delegate Name" },
          {
            key: "delegate_signature",
            label: "Delegate Signature",
            type: "signature",
            optional: true,
            raw: "Delegate Signature (approval)",
          },
          {
            key: "finance_signature",
            label: "Finance Signature",
            type: "signature",
            optional: true,
            raw: "Finance Signature (approval)",
          },
        ],
      },
    }),
    "create subject document node",
  );

  const delegateNode = unwrap(
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
      },
    }),
    "create delegate approval node",
  );

  const financeNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "approval",
      name: "Finance sign-off",
      positionX: 720,
      positionY: 120,
      config: {
        approverSource: "first_level_supervisor",
        approvalSubject: { kind: "step", nodeId: documentNode.id },
        signatureFieldKey: "finance_signature",
      },
    }),
    "create finance approval node",
  );

  // A third sign-off, decided like the delegate's, so the flow carries *two*
  // decided approval steps. Flow Insights needs more than one to show that a
  // report can tell approval types apart (ADR-040 §5).
  const recordsNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "approval",
      name: "Records sign-off",
      positionX: 1020,
      positionY: 120,
      config: {
        approverSource: "first_level_supervisor",
        approvalSubject: { kind: "step", nodeId: documentNode.id },
      },
    }),
    "create records approval node",
  );

  for (const [fromNodeId, toNodeId] of [
    [documentNode.id, delegateNode.id],
    [delegateNode.id, financeNode.id],
    [financeNode.id, recordsNode.id],
  ] as const) {
    unwrap(
      await container.useCases.createFlowEdge.execute({ flowId: flow.id, fromNodeId, toNodeId }),
      "create subject flow edge",
    );
  }

  unwrap(
    await container.useCases.updateFlow.execute(
      flow.id,
      { status: "published", visibility: { kind: "global" } },
      { canPublishToEveryone: true },
    ),
    "publish subject flow",
  );

  const session = unwrap(
    await container.useCases.startSession.execute({ flowId: flow.id, userId: ownerUserId }),
    "start subject session",
  );

  const documentMessage = unwrap(
    await container.repos.sessionMessages.create({
      sessionId: session.id,
      role: "assistant",
      content: "Here is the delegation instrument.",
      confidence: 95,
      stepNodeId: documentNode.id,
      document: {
        filename: SEED_SUBJECT_DOCUMENT,
        // -r2: the delegate's decision already re-rendered and repointed it.
        storagePath: "context/e2e-seed/delegation-instrument-r2.docx",
        summary: "Delegation of purchasing authority to Acme Ltd.",
        generatedAt: new Date().toISOString(),
      },
      documentStatus: "complete",
    }),
    "create subject document message",
  );

  unwrap(
    await container.repos.sessionStepOutputs.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: documentNode.id,
      messageId: documentMessage.id,
      fields: [
        { key: "delegate_name", label: "Delegate Name", type: "text", value: "Acme Ltd" },
      ],
    }),
    "create subject step output",
  );

  // The delegate's decided approval, with the record it locked.
  unwrap(
    await container.repos.approvals.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: delegateNode.id,
      requestedByUserId: ownerUserId,
      approverSource: "first_level_supervisor",
      approverUserId: ownerUserId,
      status: "approved",
      recordSnapshot: {
        subjectDescription: 'the output of the step "Prepare instrument"',
        subjectNodeId: documentNode.id,
        signatureFieldKey: "delegate_signature",
        attestationText:
          "Approved by:   Jane Doe\nDecision:      Approved\nVerification:  WF-3F9A2C1E7B04",
        "delegate_sign_off.decision": "approved",
        "delegate_sign_off.approver_name": "Jane Doe",
        "delegate_sign_off.approver_email": "jane.doe@example.com",
        "delegate_sign_off.decided_at": new Date().toISOString(),
        "delegate_sign_off.comment": "",
      },
    }),
    "create decided delegate approval",
  );

  // The projected decision output the second approver must NOT be shown — and
  // the row Flow Insights reads to build this step's approval columns.
  unwrap(
    await container.repos.sessionStepOutputs.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: delegateNode.id,
      fields: [
        { key: "outcome", label: "Outcome", type: "text", value: "approved" },
        { key: "revision", label: "Revision", type: "number", value: "1" },
        { key: "decided_at", label: "Decided at", type: "text", value: new Date().toISOString() },
        { key: "decided_by", label: "Decided by", type: "text", value: "Jane Doe" },
        {
          key: "approver_email",
          label: "Approver email",
          type: "text",
          value: "jane.doe@example.com",
        },
        {
          key: "applies_to",
          label: "Applies to",
          type: "text",
          value: 'the output of the step "Prepare instrument"',
        },
        { key: "comment", label: "Comment", type: "text", value: "" },
      ],
    }),
    "create delegate decision projection",
  );

  unwrap(
    await container.repos.sessions.update(session.id, {
      title: SEED_SUBJECT_SESSION_TITLE,
      currentNodeId: financeNode.id,
      // Deliberately names the previous *approval*: the context must not use it.
      graphCheckpoint: { currentNodeId: financeNode.id, advancedFrom: delegateNode.id },
    }),
    "park subject session on the second approval",
  );

  unwrap(
    await container.repos.approvals.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: financeNode.id,
      requestedByUserId: ownerUserId,
      approverSource: "first_level_supervisor",
      approverUserId: ownerUserId,
      status: "pending",
    }),
    "create pending finance approval",
  );

  // The second decided sign-off, decided *twice*: sent back for changes on the
  // first pass, approved on the second. Its projection carries the same generic
  // keys as the delegate's — which is exactly the collision Flow Insights has to
  // keep segmented by step — and two passes, which it has to report as one
  // current decision plus a revision count.
  unwrap(
    await container.repos.approvals.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: recordsNode.id,
      requestedByUserId: ownerUserId,
      approverSource: "first_level_supervisor",
      approverUserId: ownerUserId,
      status: "changes_requested",
      recordSnapshot: {
        subjectDescription: 'the output of the step "Prepare instrument"',
        subjectNodeId: documentNode.id,
        "records_sign_off.decision": "changes_requested",
        "records_sign_off.approver_name": "Sam Patel",
        "records_sign_off.approver_email": "sam.patel@example.com",
        "records_sign_off.decided_at": new Date(Date.now() - 60_000).toISOString(),
        "records_sign_off.comment": "Register reference is missing.",
      },
    }),
    "create returned records approval",
  );

  unwrap(
    await container.repos.sessionStepOutputs.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: recordsNode.id,
      fields: [
        { key: "outcome", label: "Outcome", type: "text", value: "changes_requested" },
        { key: "revision", label: "Revision", type: "number", value: "1" },
        {
          key: "decided_at",
          label: "Decided at",
          type: "text",
          value: new Date(Date.now() - 60_000).toISOString(),
        },
        { key: "decided_by", label: "Decided by", type: "text", value: "Sam Patel" },
        {
          key: "approver_email",
          label: "Approver email",
          type: "text",
          value: "sam.patel@example.com",
        },
        {
          key: "applies_to",
          label: "Applies to",
          type: "text",
          value: 'the output of the step "Prepare instrument"',
        },
        {
          key: "comment",
          label: "Comment",
          type: "text",
          value: "Register reference is missing.",
        },
      ],
    }),
    "create returned records decision projection",
  );

  unwrap(
    await container.repos.approvals.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: recordsNode.id,
      requestedByUserId: ownerUserId,
      approverSource: "first_level_supervisor",
      approverUserId: ownerUserId,
      status: "approved",
      recordSnapshot: {
        subjectDescription: 'the output of the step "Prepare instrument"',
        subjectNodeId: documentNode.id,
        "records_sign_off.decision": "approved",
        "records_sign_off.approver_name": "Sam Patel",
        "records_sign_off.approver_email": "sam.patel@example.com",
        "records_sign_off.decided_at": new Date().toISOString(),
        "records_sign_off.comment": "Filed against the delegations register.",
      },
    }),
    "create decided records approval",
  );

  unwrap(
    await container.repos.sessionStepOutputs.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: recordsNode.id,
      fields: [
        { key: "outcome", label: "Outcome", type: "text", value: "approved" },
        { key: "revision", label: "Revision", type: "number", value: "2" },
        { key: "decided_at", label: "Decided at", type: "text", value: new Date().toISOString() },
        { key: "decided_by", label: "Decided by", type: "text", value: "Sam Patel" },
        {
          key: "approver_email",
          label: "Approver email",
          type: "text",
          value: "sam.patel@example.com",
        },
        {
          key: "applies_to",
          label: "Applies to",
          type: "text",
          value: 'the output of the step "Prepare instrument"',
        },
        {
          key: "comment",
          label: "Comment",
          type: "text",
          value: "Filed against the delegations register.",
        },
      ],
    }),
    "create records decision projection",
  );

  return { sessionId: session.id, flowId: flow.id };
};

// `Draft the request (conversational) → Manager sign-off (approval, pending)`,
// owned and raised by the seed user so they are the originator who may withdraw.
//
// Its own session rather than a reuse of the subject one: withdrawing is
// destructive — it moves the session off the approval node — and the subject
// session is asserted on by other specs that would then find no gate.
export const seedWithdrawableApprovalSession = async (
  container: Container,
  ownerUserId: string,
): Promise<{ sessionId: string; draftStepName: string }> => {
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_WITHDRAW_FLOW_NAME,
      description: "Seeded flow with one pending approval the originator can withdraw",
      expertRole: "Procurement Officer",
      ownerUserId,
    }),
    "create withdraw flow",
  );

  const draftNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: SEED_WITHDRAW_DRAFT_STEP,
      positionX: 120,
      positionY: 120,
      config: {
        aiInstruction: "Draft the purchase request.",
        doneWhen: "The request is drafted.",
      },
    }),
    "create withdraw draft node",
  );

  const approvalNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "approval",
      name: "Manager sign-off",
      positionX: 420,
      positionY: 120,
      config: { approverSource: "first_level_supervisor" },
    }),
    "create withdraw approval node",
  );

  unwrap(
    await container.useCases.createFlowEdge.execute({
      flowId: flow.id,
      fromNodeId: draftNode.id,
      toNodeId: approvalNode.id,
    }),
    "create withdraw flow edge",
  );

  unwrap(
    await container.useCases.updateFlow.execute(
      flow.id,
      { status: "published", visibility: { kind: "global" } },
      { canPublishToEveryone: true },
    ),
    "publish withdraw flow",
  );

  const session = unwrap(
    await container.useCases.startSession.execute({ flowId: flow.id, userId: ownerUserId }),
    "start withdraw session",
  );

  // The draft step's output is what makes it the taken path's nearest editable
  // node — without it there is nothing for the withdrawal to return to.
  unwrap(
    await container.repos.sessionStepOutputs.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: draftNode.id,
      fields: [{ key: "amount", label: "Amount", type: "text", value: "$1,200" }],
    }),
    "create withdraw draft output",
  );

  unwrap(
    await container.repos.sessions.update(session.id, {
      title: SEED_WITHDRAW_SESSION_TITLE,
      currentNodeId: approvalNode.id,
      graphCheckpoint: { currentNodeId: approvalNode.id, advancedFrom: draftNode.id },
    }),
    "park withdraw session on the approval",
  );

  // Already sent: the gate opens in its "Awaiting approval" state, which is
  // where the withdraw affordance lives.
  unwrap(
    await container.repos.approvals.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: approvalNode.id,
      requestedByUserId: ownerUserId,
      approverSource: "first_level_supervisor",
      approverUserId: ownerUserId,
      status: "pending",
      requestMessage: SEED_WITHDRAW_REQUEST_MESSAGE,
    }),
    "create pending withdrawable approval",
  );

  return { sessionId: session.id, draftStepName: SEED_WITHDRAW_DRAFT_STEP };
};

// An approval with no step before it, so the config editor has to warn that a
// change request has nowhere to return to (ADR-044 §2).
// A flow carrying one bound signature and one unbound one, so the canvas
// advisory has both states to tell apart in a single screenshot.
//
// The bound one is deliberately bound the way the reported bug was authored:
// the approval names its slot but sits on the "last completed step" default, so
// it stores no `approvalSubject` at all. The advisory must resolve that default
// to the step upstream and stay quiet about it.
const signatureField = (key: string, label: string) => ({
  key,
  label,
  type: "signature" as const,
  optional: true,
  raw: `${label} (approval)`,
});

export const seedSignatureWarningFlow = async (
  container: Container,
  ownerUserId: string,
): Promise<string> => {
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_SIGNATURE_WARNING_FLOW_NAME,
      description: "Seeded flow with one bound signature and one nothing signs",
      expertRole: "Delegation Officer",
      ownerUserId,
    }),
    "create signature warning flow",
  );

  const instrumentNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Prepare the instrument",
      positionX: 120,
      positionY: 120,
      config: {
        aiInstruction: "Draft the delegation instrument.",
        doneWhen: "The instrument is drafted.",
        outputType: "generate_document",
        documentTemplatePath: "templates/e2e-seed-instrument.docx",
        documentTemplateContent:
          "Delegation to {{Delegate Name}}.\n{{ Supervisor Signature (approval) }}",
        documentTemplateFields: [
          { key: "delegate_name", label: "Delegate Name", type: "text", optional: false, raw: "Delegate Name" },
          signatureField("supervisor_signature", "Supervisor Signature"),
        ],
      },
    }),
    "create signature warning instrument node",
  );

  const signOffNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "approval",
      name: "Sign-off",
      positionX: 420,
      positionY: 120,
      // No `approvalSubject`: the subject is left on the default, which is what
      // the modal persists for the empty choice.
      config: {
        approverSource: "first_level_supervisor",
        signatureFieldKey: "supervisor_signature",
      },
    }),
    "create signature warning approval node",
  );

  const annexeNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Prepare the annexe",
      positionX: 720,
      positionY: 120,
      config: {
        aiInstruction: "Draft the annexe.",
        doneWhen: "The annexe is drafted.",
        outputType: "generate_document",
        documentTemplatePath: "templates/e2e-seed-annexe.docx",
        documentTemplateContent: "Annexe.\n{{ Annexe Signature (approval) }}",
        documentTemplateFields: [signatureField("annexe_signature", "Annexe Signature")],
      },
    }),
    "create signature warning annexe node",
  );

  for (const [fromNodeId, toNodeId] of [
    [instrumentNode.id, signOffNode.id],
    [signOffNode.id, annexeNode.id],
  ] as const) {
    unwrap(
      await container.useCases.createFlowEdge.execute({ flowId: flow.id, fromNodeId, toNodeId }),
      "create signature warning edge",
    );
  }

  return flow.id;
};

export const seedApprovalFirstFlow = async (
  container: Container,
  ownerUserId: string,
): Promise<string> => {
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_APPROVAL_FIRST_FLOW_NAME,
      description: "Seeded flow whose first step is an approval",
      expertRole: "Delegation Officer",
      ownerUserId,
    }),
    "create approval-first flow",
  );

  unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "approval",
      name: "Immediate sign-off",
      positionX: 120,
      positionY: 120,
      config: { approverSource: "first_level_supervisor" },
    }),
    "create approval-first node",
  );

  return flow.id;
};

// A session parked on a sent approval, with a step *after* the approval so a
// recorded off-system decision has somewhere to advance to — which is the
// observable outcome the spec asserts.
//
// Its own flow rather than a reuse of the withdrawable one: recording an
// approval advances the session, and two specs mutating one seeded session is
// how a suite starts depending on the order it runs in.
export const seedOffSystemApprovalSession = async (
  container: Container,
  ownerUserId: string,
): Promise<{ sessionId: string; nextStepName: string }> => {
  const flow = unwrap(
    await container.useCases.createFlow.execute({
      name: SEED_OFF_SYSTEM_FLOW_NAME,
      description: "Seeded flow whose pending approval accepts an off-system nomination",
      expertRole: "Procurement Officer",
      ownerUserId,
    }),
    "create off-system flow",
  );

  const draftNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: "Draft the request",
      positionX: 120,
      positionY: 120,
      config: { aiInstruction: "Draft the purchase request.", doneWhen: "The request is drafted." },
    }),
    "create off-system draft node",
  );

  const approvalNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "approval",
      name: "Manager sign-off",
      positionX: 420,
      positionY: 120,
      // No `allowOffSystemApproval` at all: the fixture proves the default is
      // permissive for a node authored before the setting existed (ADR-055 §4).
      config: { approverSource: "first_level_supervisor" },
    }),
    "create off-system approval node",
  );

  const nextNode = unwrap(
    await container.useCases.createFlowNode.execute({
      flowId: flow.id,
      type: "conversational",
      name: SEED_OFF_SYSTEM_NEXT_STEP,
      positionX: 720,
      positionY: 120,
      config: { aiInstruction: "Tell the supplier.", doneWhen: "The supplier is told." },
    }),
    "create off-system next node",
  );

  unwrap(
    await container.useCases.createFlowEdge.execute({
      flowId: flow.id,
      fromNodeId: draftNode.id,
      toNodeId: approvalNode.id,
    }),
    "create off-system draft edge",
  );

  unwrap(
    await container.useCases.createFlowEdge.execute({
      flowId: flow.id,
      fromNodeId: approvalNode.id,
      toNodeId: nextNode.id,
    }),
    "create off-system onward edge",
  );

  unwrap(
    await container.useCases.updateFlow.execute(
      flow.id,
      { status: "published", visibility: { kind: "global" } },
      { canPublishToEveryone: true },
    ),
    "publish off-system flow",
  );

  const session = unwrap(
    await container.useCases.startSession.execute({ flowId: flow.id, userId: ownerUserId }),
    "start off-system session",
  );

  unwrap(
    await container.repos.sessionStepOutputs.create({
      sessionId: session.id,
      flowId: flow.id,
      nodeId: draftNode.id,
      fields: [{ key: "amount", label: "Amount", type: "text", value: "$3,400" }],
    }),
    "create off-system draft output",
  );

  unwrap(
    await container.repos.sessions.update(session.id, {
      title: SEED_OFF_SYSTEM_SESSION_TITLE,
      currentNodeId: approvalNode.id,
      graphCheckpoint: { currentNodeId: approvalNode.id, advancedFrom: draftNode.id },
    }),
    "park off-system session on the approval",
  );

  // Already sent, so the gate opens in its "Awaiting approval" state — the only
  // state the off-system action is offered in.
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
    "create pending off-system approval",
  );

  return { sessionId: session.id, nextStepName: SEED_OFF_SYSTEM_NEXT_STEP };
};
