import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { approvalPatchToColumns, recordedSnapshotWhere } from "./drizzle-approval-repository";

const render = (statement: SQL | undefined) => new PgDialect().sqlToQuery(statement!);

describe("recordedSnapshotWhere", () => {
  it("counts only an approval that approved something", () => {
    const { sql, params } = render(recordedSnapshotWhere("sess-1"));
    const text = sql.toLowerCase();

    expect(text).toContain("session_id");
    expect(text).toContain("record_snapshot");
    expect(text).toContain("is not null");
    expect(text).toContain("status");
    expect(params).toContain("sess-1");
    expect(params).toContain("approved");
  });

  it("does not lock on a pending or changes-requested row", () => {
    // A pending row caches the resolved subject in the same column, and a change
    // request has to leave the document editable — that is the whole point of
    // the outcome.
    const { params } = render(recordedSnapshotWhere("sess-1"));

    expect(params).not.toContain("pending");
    expect(params).not.toContain("changes_requested");
  });
});

describe("approvalPatchToColumns", () => {
  it("writes the extended record whole into the existing jsonb column", () => {
    const record = {
      "manager_review.decision": "approved_with_edits",
      "manager_review.approver_name": "Jane Doe",
      "manager_review.approver_email": "jane.doe@example.com",
      "manager_review.decided_at": "2026-08-01T14:32:11.204Z",
      "manager_review.comment": "Within delegated authority.",
      "manager_review.edited_field_keys": ["commencement_date"],
      "manager_review.verification_code": "3F9A2C1E7B04",
      subjectDescription: 'the output of the step "Prepare instrument"',
      subjectNodeId: "node-draft",
      signatureFieldKey: "delegate_signature",
      attestationText: "Approved by:   Jane Doe",
      stepOutputs: [{ nodeId: "node-draft", fields: [] }],
    };

    const columns = approvalPatchToColumns({
      status: "approved_with_edits",
      recordSnapshot: record,
    });

    // No new column: everything rides `record_snapshot`, unflattened and
    // unfiltered, so extending the record shape never needs a migration.
    expect(columns.record_snapshot).toEqual(record);
    expect(columns.status).toBe("approved_with_edits");
    expect(Object.keys(columns)).toEqual(["status", "record_snapshot", "updated_at"]);
  });

  it("omits a field the patch did not mention, so a partial update stays partial", () => {
    const columns = approvalPatchToColumns({ comment: "Fix the date." });

    expect(columns).not.toHaveProperty("record_snapshot");
    expect(columns).not.toHaveProperty("status");
    expect(columns.comment).toBe("Fix the date.");
  });

  it("clears the record when the patch sets it to null", () => {
    const columns = approvalPatchToColumns({ recordSnapshot: null });

    expect(columns.record_snapshot).toBeNull();
  });

  it("maps the originator's request message to its own column", () => {
    const columns = approvalPatchToColumns({
      requestMessage: "Board meets Thursday — a signature before then would help.",
    });

    expect(columns.request_message).toContain("Board meets Thursday");
  });

  // The request note and the approver's decision comment share a row. A
  // decision must not carry the note away with it, which is why they are two
  // columns rather than one.
  it("leaves the request message untouched when a decision writes its comment", () => {
    const columns = approvalPatchToColumns({
      status: "approved",
      comment: "Within delegated authority.",
    });

    expect(columns).not.toHaveProperty("request_message");
  });

  it("records a withdrawal as a status with no decider", () => {
    const columns = approvalPatchToColumns({
      status: "withdrawn",
      decidedAt: new Date("2026-08-07T09:30:00.000Z"),
    });

    expect(columns.status).toBe("withdrawn");
    expect(columns).not.toHaveProperty("decided_by_user_id");
  });
});

describe("approvalPatchToColumns — off-system nomination", () => {
  it("writes the approval date, the evidence and the nominator as their own columns", () => {
    const columns = approvalPatchToColumns({
      status: "approved",
      decidedByUserId: "user-approver",
      decidedAt: new Date("2026-08-20T14:00:00.000Z"),
      offSystemApprovedOn: "2026-08-14",
      offSystemEvidence: {
        filename: "signed-memo.pdf",
        mimeType: "application/pdf",
        sizeBytes: 48213,
        storagePath: "approval-evidence/appr-1/2026-08-20-signed-memo.pdf",
      },
      offSystemNominatedByUserId: "user-operator",
    });

    expect(columns["off_system_approved_on"]).toBe("2026-08-14");
    expect(columns["off_system_evidence_filename"]).toBe("signed-memo.pdf");
    expect(columns["off_system_evidence_mime_type"]).toBe("application/pdf");
    expect(columns["off_system_evidence_size_bytes"]).toBe(48213);
    expect(columns["off_system_evidence_storage_path"]).toBe(
      "approval-evidence/appr-1/2026-08-20-signed-memo.pdf",
    );
    expect(columns["off_system_nominated_by_user_id"]).toBe("user-operator");
  });

  it("records the approver as the decider, not the person who entered it", () => {
    const columns = approvalPatchToColumns({
      decidedByUserId: "user-approver",
      offSystemNominatedByUserId: "user-operator",
    });

    expect(columns["decided_by_user_id"]).toBe("user-approver");
    expect(columns["off_system_nominated_by_user_id"]).toBe("user-operator");
  });

  it("leaves every off-system column alone on an ordinary decision", () => {
    const columns = approvalPatchToColumns({ status: "approved", comment: "Fine by me." });

    expect(columns).not.toHaveProperty("off_system_approved_on");
    expect(columns).not.toHaveProperty("off_system_evidence_filename");
    expect(columns).not.toHaveProperty("off_system_nominated_by_user_id");
  });

  it("clears all five evidence columns when the patch nulls the evidence", () => {
    const columns = approvalPatchToColumns({ offSystemEvidence: null });

    expect(columns["off_system_evidence_filename"]).toBeNull();
    expect(columns["off_system_evidence_mime_type"]).toBeNull();
    expect(columns["off_system_evidence_size_bytes"]).toBeNull();
    expect(columns["off_system_evidence_storage_path"]).toBeNull();
  });
});
