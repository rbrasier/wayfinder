import { describe, expect, it } from "vitest";
import type { PriorStepField } from "@rbrasier/domain";
import {
  approvalAdvancedDefaultOpen,
  approvalSubjectChoice,
  approvalSubjectFromChoice,
  CUSTOM_SUBJECT_CHOICE,
  decodeApprovalSubject,
  defaultSubjectNodeId,
  describeApprovalSubject,
  decodeChangesRequestedTarget,
  editableReturnSteps,
  encodeApprovalSubject,
  encodeChangesRequestedTarget,
  noEditablePredecessorWarning,
  signatureSlotConflict,
  signatureSlotControl,
  signatureSlotsFor,
  type PriorStep,
} from "./approval-node-config";

const priorField = (
  nodeId: string,
  key: string,
  type: PriorStepField["field"]["type"],
  stepNumber = 1,
): PriorStepField => ({
  nodeId,
  stepLabel: `${stepNumber}. ${nodeId}`,
  stepNumber,
  stepName: nodeId,
  field: { key, label: key.replace(/_/g, " "), type },
});

const step = (nodeId: string, type: PriorStep["type"]): PriorStep => ({
  nodeId,
  stepLabel: `1. ${nodeId}`,
  type,
});

describe("approval subject encoding", () => {
  it("opens an unconfigured node on the last-completed-step default", () => {
    expect(encodeApprovalSubject(undefined)).toEqual({
      kind: "step",
      nodeId: "",
      instruction: "",
    });
  });

  it("round-trips a named step", () => {
    const encoded = encodeApprovalSubject({ kind: "step", nodeId: "node-draft" });

    expect(encoded.nodeId).toBe("node-draft");
    expect(decodeApprovalSubject(encoded)).toEqual({ kind: "step", nodeId: "node-draft" });
  });

  it("round-trips a custom instruction", () => {
    const encoded = encodeApprovalSubject({ kind: "custom", instruction: "Describe the delegation." });

    expect(encoded).toEqual({ kind: "custom", nodeId: "", instruction: "Describe the delegation." });
    expect(decodeApprovalSubject(encoded)).toEqual({
      kind: "custom",
      instruction: "Describe the delegation.",
    });
  });

  it("stores nothing for the default choice, so the runtime default applies", () => {
    expect(decodeApprovalSubject({ kind: "step", nodeId: "", instruction: "" })).toBeUndefined();
  });

  it("stores nothing for an empty custom instruction rather than an empty subject", () => {
    expect(
      decodeApprovalSubject({ kind: "custom", nodeId: "", instruction: "   " }),
    ).toBeUndefined();
  });
});

// The modal asks one question, not two: the subject select's options are the
// default, every earlier step, and "something I'll describe". These map that
// single string to the kind/nodeId pair the config mapping already stores.
describe("approval subject as a single choice", () => {
  it("reads the default as the empty choice", () => {
    expect(approvalSubjectChoice({ kind: "step", nodeId: "" })).toBe("");
  });

  it("reads a named step as that step's node id", () => {
    expect(approvalSubjectChoice({ kind: "step", nodeId: "node-draft" })).toBe("node-draft");
  });

  it("reads a described subject as the custom sentinel", () => {
    expect(approvalSubjectChoice({ kind: "custom", nodeId: "" })).toBe(CUSTOM_SUBJECT_CHOICE);
  });

  it("turns the empty choice back into the default", () => {
    expect(approvalSubjectFromChoice("")).toEqual({ kind: "step", nodeId: "" });
  });

  it("turns a node id back into that named step", () => {
    expect(approvalSubjectFromChoice("node-draft")).toEqual({ kind: "step", nodeId: "node-draft" });
  });

  it("turns the custom sentinel back into a described subject with no step", () => {
    expect(approvalSubjectFromChoice(CUSTOM_SUBJECT_CHOICE)).toEqual({
      kind: "custom",
      nodeId: "",
    });
  });

  it("round-trips every choice the select can offer", () => {
    const choices = ["", "node-draft", CUSTOM_SUBJECT_CHOICE];

    for (const choice of choices) {
      expect(approvalSubjectChoice(approvalSubjectFromChoice(choice))).toBe(choice);
    }
  });

  // A step cannot be named "__describe__", but the sentinel must not be
  // mistakable for one if a node id ever looked like it.
  it("keeps the sentinel out of the node id space", () => {
    expect(CUSTOM_SUBJECT_CHOICE).not.toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("changes-requested target encoding", () => {
  it("opens an unconfigured node on the nearest-editable default", () => {
    expect(encodeChangesRequestedTarget(undefined)).toBe("");
    expect(encodeChangesRequestedTarget({ kind: "nearest_editable" })).toBe("");
  });

  it("round-trips a named step", () => {
    expect(encodeChangesRequestedTarget({ kind: "step", nodeId: "node-intake" })).toBe(
      "node-intake",
    );
    expect(decodeChangesRequestedTarget("node-intake")).toEqual({
      kind: "step",
      nodeId: "node-intake",
    });
  });

  it("stores nothing for the default choice", () => {
    expect(decodeChangesRequestedTarget("")).toBeUndefined();
  });
});

describe("editableReturnSteps", () => {
  it("offers only steps an operator can actually change", () => {
    const steps = [
      step("intake", "conversational"),
      step("enrich", "auto"),
      step("approval-a", "approval"),
      step("reminder", "scheduled"),
      step("lookup", "mcp"),
      step("draft", "conversational"),
    ];

    expect(editableReturnSteps(steps).map((each) => each.nodeId)).toEqual(["intake", "draft"]);
  });
});

describe("signature slots", () => {
  const fields = [
    priorField("node-other", "legal_signature", "signature", 1),
    priorField("node-draft", "amount", "currency", 2),
    priorField("node-draft", "delegate_signature", "signature", 2),
    priorField("node-draft", "finance_signature", "signature", 2),
  ];

  it("lists the subject step's signature fields only", () => {
    expect(signatureSlotsFor(fields, "node-draft").map((slot) => slot.key)).toEqual([
      "delegate_signature",
      "finance_signature",
    ]);
  });

  // The default previously offered nothing, so the common single-document flow
  // could not target its own signature without the author naming the step by
  // hand — and an unnamed slot is never signed.
  it("resolves the last-completed default to the nearest earlier step", () => {
    expect(signatureSlotsFor(fields, "").map((slot) => slot.key)).toEqual([
      "delegate_signature",
      "finance_signature",
    ]);
    expect(defaultSubjectNodeId(fields)).toBe("node-draft");
  });

  it("offers nothing on the default when no earlier step declares fields", () => {
    expect(signatureSlotsFor([], "")).toEqual([]);
    expect(defaultSubjectNodeId([])).toBe("");
  });

  it("offers nothing when the nearest earlier step declares no signature", () => {
    const noSignatures = [priorField("node-draft", "amount", "currency", 2)];

    expect(signatureSlotsFor(noSignatures, "")).toEqual([]);
  });

  it("shows no control when the template declares no signature", () => {
    expect(signatureSlotControl([])).toEqual({ mode: "none" });
  });

  // The "auto" mode this replaces bound nothing: it rendered no control, left
  // signatureFieldKey empty in the saved config, and DecideApproval then read
  // null — so a single-signature template was never signed while the modal said
  // it would be (ADR-043 §5, amended v0.26.2).
  it("still asks with exactly one, so the choice is written rather than assumed", () => {
    const slots = [{ key: "delegate_signature", label: "Delegate Signature" }];

    expect(signatureSlotControl(slots)).toEqual({ mode: "choose", slots });
  });

  it("asks the author to pick when there are two or more", () => {
    const slots = signatureSlotsFor(fields, "node-draft");

    expect(signatureSlotControl(slots)).toEqual({ mode: "choose", slots });
  });

  it("rejects two approval steps signing the same slot", () => {
    const slots = signatureSlotsFor(fields, "node-draft");

    // Named by its label, so the author sees the slot as it reads in the template.
    expect(
      signatureSlotConflict("delegate_signature", ["delegate_signature"], slots),
    ).toContain("delegate signature");
    expect(signatureSlotConflict("finance_signature", ["delegate_signature"], slots)).toBeNull();
    expect(signatureSlotConflict("", ["delegate_signature"], slots)).toBeNull();
  });
});

describe("describeApprovalSubject", () => {
  it("names the default so an untouched node still says what it approves", () => {
    expect(describeApprovalSubject({})).toBe("Approves the last completed step");
  });

  it("distinguishes a chosen step from a described subject", () => {
    expect(describeApprovalSubject({ approvalSubject: { kind: "step", nodeId: "node-draft" } })).toBe(
      "Approves a chosen step",
    );
    expect(
      describeApprovalSubject({ approvalSubject: { kind: "custom", instruction: "the delegation" } }),
    ).toBe("Approves a described subject");
  });

  it("says when the step also signs the document", () => {
    expect(describeApprovalSubject({ signatureFieldKey: "delegate_signature" })).toContain(
      "signs the document",
    );
  });
});

describe("approvalAdvancedDefaultOpen", () => {
  it("stays closed when the subject step declares no signature", () => {
    const fields = [priorField("node-draft", "applicant_name", "text")];

    expect(approvalAdvancedDefaultOpen(fields, "node-draft")).toBe(false);
  });

  it("opens when the subject step declares one signature", () => {
    const fields = [
      priorField("node-draft", "applicant_name", "text"),
      priorField("node-draft", "delegate_signature", "signature"),
    ];

    expect(approvalAdvancedDefaultOpen(fields, "node-draft")).toBe(true);
  });

  it("opens when the subject step declares several signatures", () => {
    const fields = [
      priorField("node-draft", "delegate_signature", "signature"),
      priorField("node-draft", "witness_signature", "signature"),
    ];

    expect(approvalAdvancedDefaultOpen(fields, "node-draft")).toBe(true);
  });

  // The lone-slot effect claims a single signature as soon as the modal opens,
  // so a rule keyed on "unclaimed" would collapse the commonest case — one
  // signature, one approval step — hiding the control the author came to check.
  it("opens on a slot that is already claimed", () => {
    const fields = [priorField("node-draft", "delegate_signature", "signature")];

    expect(approvalAdvancedDefaultOpen(fields, "node-draft")).toBe(true);
  });

  it("resolves the empty subject choice through the last-completed-step default", () => {
    const fields = [
      priorField("node-intake", "applicant_name", "text", 1),
      priorField("node-draft", "delegate_signature", "signature", 2),
    ];

    expect(approvalAdvancedDefaultOpen(fields, "")).toBe(true);
  });

  it("stays closed when the default subject step has no signature", () => {
    const fields = [
      priorField("node-draft", "delegate_signature", "signature", 1),
      priorField("node-review", "reviewer_note", "text", 2),
    ];

    expect(approvalAdvancedDefaultOpen(fields, "")).toBe(false);
  });

  it("stays closed when there are no prior steps at all", () => {
    expect(approvalAdvancedDefaultOpen([], "")).toBe(false);
  });
});

describe("noEditablePredecessorWarning", () => {
  it("warns at authoring time when nothing earlier can be edited", () => {
    const warning = noEditablePredecessorWarning([step("enrich", "auto")], "");

    expect(warning).toContain("hold the session");
  });

  it("stays quiet when an editable step precedes the approval", () => {
    expect(noEditablePredecessorWarning([step("intake", "conversational")], "")).toBeNull();
  });

  it("stays quiet when the author named a target explicitly", () => {
    expect(noEditablePredecessorWarning([step("enrich", "auto")], "node-enrich")).toBeNull();
  });
});
