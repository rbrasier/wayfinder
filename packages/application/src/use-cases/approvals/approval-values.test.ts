import { describe, expect, it } from "vitest";
import { ok, type Approval, type IApprovalRepository, type TemplateField } from "@rbrasier/domain";
import { approvalValuesForStep } from "./approval-values";

const at = (iso: string) => new Date(iso);

const field = (
  key: string,
  type: TemplateField["type"] = "text",
  signatureLabel?: string,
): TemplateField => ({
  key,
  label: key,
  type,
  optional: type === "signature" || type === "approval_comment",
  raw: key,
  ...(signatureLabel ? { signatureLabel } : {}),
});

const fields = [field("amount"), field("finance_signature", "signature")];

const approval = (overrides: Partial<Approval> = {}): Approval =>
  ({
    id: "approval-a",
    sessionId: "sess-1",
    flowId: "flow-1",
    nodeId: "node-appr",
    messageId: null,
    requestedByUserId: "user-1",
    approverSource: "first_level_supervisor",
    suggestedApproverUserId: null,
    approverUserId: "manager-1",
    approverEmail: null,
    isOverride: false,
    status: "approved",
    decidedByUserId: "manager-1",
    decidedAt: at("2026-08-01T14:32:00Z"),
    comment: null,
    recordSnapshot: {
      subjectNodeId: "node-draft",
      signatureFieldKey: "finance_signature",
      attestationText: "Approved by:   Jane Doe",
    },
    createdAt: at("2026-08-01T12:00:00Z"),
    updatedAt: at("2026-08-01T14:32:00Z"),
    ...overrides,
  }) as Approval;

// The repository orders newest-first, so a fake that returned insertion order
// would hide an ordering bug rather than catch one.
const repositoryOf = (rows: Approval[]): IApprovalRepository =>
  ({
    listBySession: async () =>
      ok(
        [...rows].sort(
          (first, second) =>
            (second.decidedAt ?? second.createdAt).getTime() -
            (first.decidedAt ?? first.createdAt).getTime(),
        ),
      ),
  }) as unknown as IApprovalRepository;

const valuesFor = (rows: Approval[]) =>
  approvalValuesForStep(repositoryOf(rows), "sess-1", "node-draft", fields);

describe("approvalValuesForStep", () => {
  it("fills a slot from the approval that decided it", async () => {
    expect(await valuesFor([approval()])).toEqual({
      finance_signature: "Approved by:   Jane Doe",
    });
  });

  it("leaves a slot nobody has decided empty", async () => {
    expect(await valuesFor([])).toEqual({ finance_signature: "" });
  });

  it("ignores a pending approval, which has decided nothing", async () => {
    const pending = approval({
      status: "pending",
      decidedAt: null,
      recordSnapshot: { subjectNodeId: "node-draft", signatureFieldKey: "finance_signature" },
    });

    expect(await valuesFor([pending])).toEqual({ finance_signature: "" });
  });

  it("ignores an approval that signed a different step", async () => {
    const elsewhere = approval({
      recordSnapshot: {
        subjectNodeId: "node-other",
        signatureFieldKey: "finance_signature",
        attestationText: "Approved by:   Someone Else",
      },
    });

    expect(await valuesFor([elsewhere])).toEqual({ finance_signature: "" });
  });

  // A step can be approved on the second pass: rejected, amended, then sent back
  // and approved. Both decisions are kept as rows, but the slot shows one block —
  // and showing the superseded one would leave a document that was approved
  // reading "Rejected by" on its face.
  describe("a step decided more than once", () => {
    const rejected = approval({
      id: "approval-first",
      status: "rejected",
      decidedAt: at("2026-08-01T09:00:00Z"),
      createdAt: at("2026-08-01T08:00:00Z"),
      recordSnapshot: {
        subjectNodeId: "node-draft",
        signatureFieldKey: "finance_signature",
        attestationText: "Rejected by:   Jane Doe",
      },
    });
    const approvedAfterAmendment = approval({
      id: "approval-second",
      decidedAt: at("2026-08-02T11:00:00Z"),
      createdAt: at("2026-08-02T10:00:00Z"),
      recordSnapshot: {
        subjectNodeId: "node-draft",
        signatureFieldKey: "finance_signature",
        attestationText: "Approved by:   Jane Doe",
      },
    });

    it("shows the latest decision, not the one it superseded", async () => {
      expect(await valuesFor([rejected, approvedAfterAmendment])).toEqual({
        finance_signature: "Approved by:   Jane Doe",
      });
    });

    it("does not depend on the order the repository returns", async () => {
      expect(await valuesFor([approvedAfterAmendment, rejected])).toEqual({
        finance_signature: "Approved by:   Jane Doe",
      });
    });

    it("shows a later rejection over an earlier approval, the same way round", async () => {
      const rejectedLast = approval({
        id: "approval-third",
        status: "rejected",
        decidedAt: at("2026-08-03T11:00:00Z"),
        recordSnapshot: {
          subjectNodeId: "node-draft",
          signatureFieldKey: "finance_signature",
          attestationText: "Rejected by:   Sam Patel",
        },
      });

      expect(await valuesFor([approvedAfterAmendment, rejectedLast])).toEqual({
        finance_signature: "Rejected by:   Sam Patel",
      });
    });

    // A row decided before the column existed has no `decidedAt` to sort on.
    it("falls back to creation order when a decision carries no timestamp", async () => {
      const undated = approval({
        id: "approval-undated",
        decidedAt: null,
        createdAt: at("2026-07-01T10:00:00Z"),
        recordSnapshot: {
          subjectNodeId: "node-draft",
          signatureFieldKey: "finance_signature",
          attestationText: "Approved by:   Older Record",
        },
      });

      expect(await valuesFor([undated, rejected])).toEqual({
        finance_signature: "Rejected by:   Jane Doe",
      });
    });
  });
});

// The comment belongs to a named signature, so a document carrying several
// keeps each approver's words under their own block (ADR-043 §3, amended).
describe("approval comment slots", () => {
  const commentFields = [
    field("amount"),
    field("finance_signature", "signature"),
    field("finance_note", "approval_comment", "finance_signature"),
  ];

  const commentValuesFor = (rows: Approval[]) =>
    approvalValuesForStep(repositoryOf(rows), "sess-1", "node-draft", commentFields);

  it("fills the comment from the approval that signed the slot it names", async () => {
    const withComment = approval({ comment: "Within delegated authority." });

    expect(await commentValuesFor([withComment])).toEqual({
      finance_signature: "Approved by:   Jane Doe",
      finance_note: "Within delegated authority.",
    });
  });

  it("leaves the comment empty while the slot is undecided", async () => {
    expect(await commentValuesFor([])).toEqual({ finance_signature: "", finance_note: "" });
  });

  // Rendering "None" or the approver's name would imply a rationale that was
  // never given, the way a filled slot would imply an approval that never was.
  it("leaves the comment empty when the approver left none", async () => {
    expect(await commentValuesFor([approval({ comment: null })])).toEqual({
      finance_signature: "Approved by:   Jane Doe",
      finance_note: "",
    });
  });

  it("takes the comment from the same decision as the block beside it", async () => {
    const rejected = approval({
      id: "approval-first",
      status: "rejected",
      comment: "Over the delegation limit.",
      decidedAt: at("2026-08-01T09:00:00Z"),
      recordSnapshot: {
        subjectNodeId: "node-draft",
        signatureFieldKey: "finance_signature",
        attestationText: "Rejected by:   Jane Doe",
      },
    });
    const approvedAfterAmendment = approval({
      id: "approval-second",
      comment: "Reduced scope accepted.",
      decidedAt: at("2026-08-02T11:00:00Z"),
    });

    expect(await commentValuesFor([rejected, approvedAfterAmendment])).toEqual({
      finance_signature: "Approved by:   Jane Doe",
      finance_note: "Reduced scope accepted.",
    });
  });

  it("keeps two signatures' comments apart on one document", async () => {
    const twoSlots = [
      field("finance_signature", "signature"),
      field("finance_note", "approval_comment", "finance_signature"),
      field("legal_signature", "signature"),
      field("legal_note", "approval_comment", "legal_signature"),
    ];
    const finance = approval({ comment: "Budget confirmed." });
    const legal = approval({
      id: "approval-legal",
      comment: "Clause 7 amended.",
      decidedAt: at("2026-08-02T09:00:00Z"),
      recordSnapshot: {
        subjectNodeId: "node-draft",
        signatureFieldKey: "legal_signature",
        attestationText: "Approved by:   Sam Patel",
      },
    });

    expect(
      await approvalValuesForStep(
        repositoryOf([finance, legal]),
        "sess-1",
        "node-draft",
        twoSlots,
      ),
    ).toEqual({
      finance_signature: "Approved by:   Jane Doe",
      finance_note: "Budget confirmed.",
      legal_signature: "Approved by:   Sam Patel",
      legal_note: "Clause 7 amended.",
    });
  });

  it("ignores an approval on a different step, comment and all", async () => {
    const elsewhere = approval({
      comment: "Signed on another document.",
      recordSnapshot: {
        subjectNodeId: "node-other",
        signatureFieldKey: "finance_signature",
        attestationText: "Approved by:   Someone Else",
      },
    });

    expect(await commentValuesFor([elsewhere])).toEqual({
      finance_signature: "",
      finance_note: "",
    });
  });

  it("leaves a comment bound to nothing empty rather than guessing", async () => {
    const unbound = [
      field("finance_signature", "signature"),
      field("stray_note", "approval_comment"),
    ];

    expect(
      await approvalValuesForStep(
        repositoryOf([approval({ comment: "Within delegated authority." })]),
        "sess-1",
        "node-draft",
        unbound,
      ),
    ).toEqual({
      finance_signature: "Approved by:   Jane Doe",
      stray_note: "",
    });
  });
});
