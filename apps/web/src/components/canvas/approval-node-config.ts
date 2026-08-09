import type {
  ApprovalSubject,
  ChangesRequestedTarget,
  PriorStepField,
} from "@rbrasier/domain";

// Maps the approval modal's subject / signature / routing fields to the
// persisted `ApprovalNodeConfig` jsonb, and back. Every control has an "absent"
// value that matches the runtime default, so an approval node authored before
// this feature opens on exactly the behaviour it already had.

export type ApprovalSubjectKind = "step" | "custom";

// A step earlier in the flow, as the canvas knows it. `type` drives the
// return-target list, which only offers steps an operator can actually change.
export interface PriorStep {
  nodeId: string;
  stepLabel: string;
  type: "conversational" | "auto" | "scheduled" | "approval" | "mcp";
}

// The empty string is the "use the default" sentinel for both dropdowns: an
// unset subject means the last completed step, an unset return target means the
// nearest editable one. Encoding that as "" keeps a native <select> honest,
// since its value is always a string.
export const DEFAULT_CHOICE = "";

export const encodeApprovalSubject = (
  subject: ApprovalSubject | undefined,
): { kind: ApprovalSubjectKind; nodeId: string; instruction: string } => {
  if (subject?.kind === "custom") {
    return { kind: "custom", nodeId: DEFAULT_CHOICE, instruction: subject.instruction };
  }
  return { kind: "step", nodeId: subject?.nodeId ?? DEFAULT_CHOICE, instruction: "" };
};

export const decodeApprovalSubject = (values: {
  kind: ApprovalSubjectKind;
  nodeId: string;
  instruction: string;
}): ApprovalSubject | undefined => {
  if (values.kind === "custom") {
    const instruction = values.instruction.trim();
    // An empty instruction is not a subject, so it stores nothing and falls back
    // to the last completed step rather than asking the model to summarise "".
    return instruction ? { kind: "custom", instruction } : undefined;
  }
  return values.nodeId ? { kind: "step", nodeId: values.nodeId } : undefined;
};

// The modal asks one question — "what is being approved?" — whose answers are
// the default, any earlier step, or a subject the author describes. A native
// <select> value is always a string, so the described case needs a sentinel
// that cannot collide with a node id.
export const CUSTOM_SUBJECT_CHOICE = "__describe__";

export const approvalSubjectChoice = (values: {
  kind: ApprovalSubjectKind;
  nodeId: string;
}): string => (values.kind === "custom" ? CUSTOM_SUBJECT_CHOICE : values.nodeId);

export const approvalSubjectFromChoice = (
  choice: string,
): { kind: ApprovalSubjectKind; nodeId: string } =>
  choice === CUSTOM_SUBJECT_CHOICE
    ? { kind: "custom", nodeId: DEFAULT_CHOICE }
    : { kind: "step", nodeId: choice };

export const encodeChangesRequestedTarget = (
  target: ChangesRequestedTarget | undefined,
): string => (target?.kind === "step" ? target.nodeId : DEFAULT_CHOICE);

export const decodeChangesRequestedTarget = (
  nodeId: string,
): ChangesRequestedTarget | undefined => (nodeId ? { kind: "step", nodeId } : undefined);

// Only a conversational step gives the operator something to change, so those
// are the only ones offered as a return target (ADR-044 §2).
export const editableReturnSteps = (priorSteps: PriorStep[]): PriorStep[] =>
  priorSteps.filter((step) => step.type === "conversational");

// Which step the "last completed step" default will resolve to, as far as the
// canvas can tell: the nearest earlier step that declares any fields, which in a
// linear flow is exactly the step the runtime will have just finished.
//
// This is a prediction, not a guarantee — on a branching flow the step that
// actually completes last depends on the path taken. It is offered anyway
// because the alternative was worse: the default subject showed no signature
// control at all, so the common single-document flow could not target its own
// signature without the author first naming the step by hand. Choosing a slot
// here writes an explicit `signatureFieldKey`, which is what the runtime reads,
// so a correct prediction becomes a durable configuration.
export const defaultSubjectNodeId = (priorStepFields: PriorStepField[]): string => {
  let nearest: PriorStepField | null = null;
  for (const entry of priorStepFields) {
    if (!nearest || entry.stepNumber > nearest.stepNumber) nearest = entry;
  }
  return nearest?.nodeId ?? "";
};

// The signature slots declared by the subject step's template. Read from the
// prior-step field list, which carries the raw template fields — `nodeFieldSet`
// filters signatures out on purpose, and this is the one place that needs them.
//
// An empty `subjectNodeId` is the last-completed-step default, which resolves to
// the nearest earlier step rather than to nothing.
export const signatureSlotsFor = (
  priorStepFields: PriorStepField[],
  subjectNodeId: string,
): Array<{ key: string; label: string }> => {
  const targetNodeId = subjectNodeId || defaultSubjectNodeId(priorStepFields);
  if (!targetNodeId) return [];

  const seen = new Set<string>();
  const slots: Array<{ key: string; label: string }> = [];
  for (const entry of priorStepFields) {
    if (entry.nodeId !== targetNodeId) continue;
    if (entry.field.type !== "signature") continue;
    if (seen.has(entry.field.key)) continue;
    seen.add(entry.field.key);
    slots.push({ key: entry.field.key, label: entry.field.label });
  }
  return slots;
};

export type SignatureSlotControl =
  // The template declares none, so the approval simply records no signature.
  | { mode: "none" }
  // One or more: the author says which slot this step signs, and a lone slot
  // arrives pre-selected rather than hidden.
  | { mode: "choose"; slots: Array<{ key: string; label: string }> };

// There is deliberately no "bind it automatically" mode. One existed until
// v0.26.2 and bound nothing: it rendered no control, so `signatureFieldKey` was
// never written, and every single-signature template decided without signing
// while the modal said otherwise (ADR-043 §5, amended).
export const signatureSlotControl = (
  slots: Array<{ key: string; label: string }>,
): SignatureSlotControl =>
  slots.length === 0 ? { mode: "none" } : { mode: "choose", slots };

// Whether the modal's Advanced section starts expanded. Signing is the point of
// an approval step on a signed document, and the canvas advisory for an
// unclaimed slot sends the author here to set it — so the section holding that
// control opens whenever the subject step has a signature at all.
//
// Deliberately keyed on the slots existing rather than on their being unclaimed:
// the lone-slot effect in the modal claims a single signature the moment it
// opens, so an "unclaimed only" rule would collapse the commonest case — one
// signature, one approval step — on the control the author came to check.
export const approvalAdvancedDefaultOpen = (
  priorStepFields: PriorStepField[],
  subjectNodeId: string,
): boolean => signatureSlotsFor(priorStepFields, subjectNodeId).length > 0;

// Two approval steps must not sign the same slot on the same document — a
// config-time error, not a runtime surprise (ADR-043 §5).
export const signatureSlotConflict = (
  chosenKey: string,
  takenKeys: string[],
  slots: Array<{ key: string; label: string }>,
): string | null => {
  if (!chosenKey || !takenKeys.includes(chosenKey)) return null;
  const label = slots.find((slot) => slot.key === chosenKey)?.label ?? chosenKey;
  return `Another approval step already signs "${label}". Pick a different slot.`;
};

// The one-line summary shown on the canvas card, so an author can see what a
// step approves without opening it. The card has no view of the graph, so a
// named step is described by position rather than by name.
export const describeApprovalSubject = (config: {
  approvalSubject?: ApprovalSubject;
  signatureFieldKey?: string;
}): string => {
  const subject = config.approvalSubject;
  const base =
    subject?.kind === "custom"
      ? "Approves a described subject"
      : subject?.nodeId
        ? "Approves a chosen step"
        : "Approves the last completed step";
  return config.signatureFieldKey ? `${base} · signs the document` : base;
};

// Surfaced while authoring rather than left to be discovered at decision time:
// a change request against a flow with no editable predecessor holds the
// session instead of routing it.
export const noEditablePredecessorWarning = (
  priorSteps: PriorStep[],
  chosenNodeId: string,
): string | null => {
  if (chosenNodeId) return null;
  if (editableReturnSteps(priorSteps).length > 0) return null;
  return "No earlier step in this flow can be edited, so a change request will hold the session here instead of returning it. Add a conversational step before this approval.";
};
