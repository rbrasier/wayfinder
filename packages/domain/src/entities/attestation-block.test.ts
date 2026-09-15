import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildAttestationBlock, type AttestationInput } from "./attestation-block";

// The adapter injects node:crypto so the domain stays dependency-free; the test
// supplies the same primitive.
const sha256Hex = (input: string): string =>
  createHash("sha256").update(input, "utf8").digest("hex");

const input = (overrides: Partial<AttestationInput> = {}): AttestationInput => ({
  approvalId: "11111111-1111-1111-1111-111111111111",
  sessionId: "sess-1",
  nodeId: "node-appr",
  approverName: "Jane Doe",
  approverEmail: "jane.doe@example.com",
  approverRole: "Delegate",
  decision: "approved",
  decidedAt: new Date("2026-08-01T14:32:11.204Z"),
  comment: "Within delegated authority.",
  subjectDescription: "the output of the step \"Prepare instrument\"",
  offSystemApprovedOn: null,
  ...overrides,
});

describe("buildAttestationBlock", () => {
  it("names the approver, their role, the decision, the time and the comment", () => {
    const block = buildAttestationBlock(input(), sha256Hex);

    expect(block.text).toContain("Jane Doe (jane.doe@example.com)");
    expect(block.text).toContain("Delegate");
    expect(block.text).toContain("Approved");
    expect(block.text).toContain("01-08-2026 14:32 UTC");
    expect(block.text).toContain("Within delegated authority.");
  });

  it("carries the verification code in the block", () => {
    const block = buildAttestationBlock(input(), sha256Hex);

    expect(block.verificationCode).toMatch(/^[0-9A-F]{12}$/);
    expect(block.text).toContain(`WF-${block.verificationCode}`);
  });

  it("renders a rejection as rejected rather than dressing it up", () => {
    const block = buildAttestationBlock(input({ decision: "rejected" }), sha256Hex);

    expect(block.text).toContain("Rejected");
    expect(block.text).not.toContain("Approved");
  });

  it("names a changes-requested decision", () => {
    const block = buildAttestationBlock(input({ decision: "changes_requested" }), sha256Hex);

    expect(block.text).toContain("Changes requested");
  });

  // A reader skimming a signed page takes in the first line and moves on. If that
  // line is neutral, a rejection reads as a signature until they reach the
  // decision line — the one misreading an attestation must never permit.
  describe("the first line names the outcome", () => {
    const firstLine = (decision: AttestationInput["decision"]): string =>
      buildAttestationBlock(input({ decision }), sha256Hex).text.split("\n")[0] ?? "";

    it("says rejected on a rejection", () => {
      expect(firstLine("rejected")).toBe("Rejected by:   Jane Doe (jane.doe@example.com)");
    });

    it("says changes requested on a change request", () => {
      expect(firstLine("changes_requested")).toContain("Changes requested by:");
      expect(firstLine("changes_requested")).not.toContain("Approved");
    });

    it("says approved on an approval, keeping the ADR-043 wording", () => {
      expect(firstLine("approved")).toBe("Approved by:   Jane Doe (jane.doe@example.com)");
    });

    // It was approved. The Decision line carries the edits, so the outcome line
    // stays short and the block keeps its column.
    it("says approved when the approver also edited", () => {
      expect(firstLine("approved_with_edits")).toBe(
        "Approved by:   Jane Doe (jane.doe@example.com)",
      );
      expect(buildAttestationBlock(input({ decision: "approved_with_edits" }), sha256Hex).text)
        .toContain("Decision:      Approved with edits");
    });
  });

  it("keeps its values in one column when the outcome label is the longest", () => {
    const block = buildAttestationBlock(input({ decision: "changes_requested" }), sha256Hex);
    const columns = block.text
      .split("\n")
      .map((line) => line.length - line.replace(/^\S+(?: \S+)*?:\s+/, "").length);

    expect(new Set(columns).size).toBe(1);
  });

  it("omits the role and comment lines when there are none", () => {
    const block = buildAttestationBlock(
      input({ approverRole: null, comment: null }),
      sha256Hex,
    );

    expect(block.text).not.toContain("Role:");
    expect(block.text).not.toContain("Comment:");
    expect(block.text).toContain("Jane Doe");
  });

  it("falls back to the email when the approver has no name on record", () => {
    const block = buildAttestationBlock(input({ approverName: null }), sha256Hex);

    expect(block.text).toContain("jane.doe@example.com");
  });

  it("is stable for a fixed record", () => {
    const first = buildAttestationBlock(input(), sha256Hex);
    const second = buildAttestationBlock(input(), sha256Hex);

    expect(second.verificationCode).toBe(first.verificationCode);
    expect(second.text).toBe(first.text);
  });

  it("changes the code when any bound field changes", () => {
    const baseline = buildAttestationBlock(input(), sha256Hex).verificationCode;

    const variants: Array<Partial<AttestationInput>> = [
      { approverName: "Jane Doh" },
      { approverEmail: "someone.else@example.com" },
      { approverRole: "Finance" },
      { decision: "rejected" },
      { decidedAt: new Date("2026-08-01T14:32:11.205Z") },
      { comment: "Outside delegated authority." },
      { subjectDescription: "something else entirely" },
      { approvalId: "22222222-2222-2222-2222-222222222222" },
    ];

    for (const variant of variants) {
      expect(buildAttestationBlock(input(variant), sha256Hex).verificationCode).not.toBe(baseline);
    }
  });

  it("does not describe itself as a qualified or digital signature", () => {
    const block = buildAttestationBlock(input(), sha256Hex).text.toLowerCase();

    expect(block).not.toContain("qualified");
    expect(block).not.toContain("digitally signed");
  });
});

describe("buildAttestationBlock — recorded off system", () => {
  const offSystem = () => input({ offSystemApprovedOn: "2026-07-28" });

  it("says on the decision line that the approval was recorded off system", () => {
    const block = buildAttestationBlock(offSystem(), sha256Hex);

    expect(block.text).toContain("Approved (recorded off system)");
  });

  it("still opens by naming the approver, who is who approved", () => {
    const block = buildAttestationBlock(offSystem(), sha256Hex);

    expect(block.text).toContain("Approved by:");
    expect(block.text).toContain("Jane Doe (jane.doe@example.com)");
  });

  it("shows the date the approval happened, not the moment it was recorded", () => {
    const block = buildAttestationBlock(offSystem(), sha256Hex);

    expect(block.text).toContain("28-07-2026");
    expect(block.text).not.toContain("01-08-2026");
  });

  it("shows no clock time, because only a date was ever confirmed", () => {
    const block = buildAttestationBlock(offSystem(), sha256Hex);

    expect(block.text).not.toContain("UTC");
    expect(block.text).not.toContain("14:32");
  });

  it("still carries a verification code", () => {
    const block = buildAttestationBlock(offSystem(), sha256Hex);

    expect(block.verificationCode).toMatch(/^[0-9A-F]{12}$/);
    expect(block.text).toContain(`WF-${block.verificationCode}`);
  });

  it("binds the approval date into the code, so two dates cannot share one", () => {
    const first = buildAttestationBlock(offSystem(), sha256Hex);
    const second = buildAttestationBlock(input({ offSystemApprovedOn: "2026-07-29" }), sha256Hex);

    expect(first.verificationCode).not.toBe(second.verificationCode);
  });

  it("leaves an in-system block's code exactly as it was before this existed", () => {
    // The off-system date joins the canonical string only when it is set. An
    // in-system approval decided after this feature shipped must still produce
    // the code it would have produced before it, or two identical decisions
    // months apart would verify differently.
    const inSystem = buildAttestationBlock(input({ offSystemApprovedOn: null }), sha256Hex);

    expect(inSystem.verificationCode).toBe("138E648F1D5F");
    expect(inSystem.text).toContain("01-08-2026 14:32 UTC");
    expect(inSystem.text).not.toContain("off system");
  });
});
