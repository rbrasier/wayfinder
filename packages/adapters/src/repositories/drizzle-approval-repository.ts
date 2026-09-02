import { and, desc, eq, inArray, isNotNull, ne, notInArray, or } from "drizzle-orm";
import {
  APPROVED_STATUSES,
  DISCARDED_SESSION_STATUSES,
  domainError,
  err,
  ok,
  type Approval,
  type ApprovalListScope,
  type ApprovalUpdate,
  type ApproverQuery,
  type IApprovalRepository,
  type NewApproval,
  type Result,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_session_approvals, app_sessions } from "../db/schema/wayfinder";

// The governed record exists once an approval has *approved* something. Two
// other states carry a `record_snapshot` and must not lock the document: a
// pending row caches the resolved subject there (ADR-040 §2), and a
// `changes_requested` row records its decision — locking on that one would stop
// the operator making the very changes they were asked for (ADR-044 §3).
export const recordedSnapshotWhere = (sessionId: string) =>
  and(
    eq(app_session_approvals.session_id, sessionId),
    inArray(app_session_approvals.status, [...APPROVED_STATUSES]),
    isNotNull(app_session_approvals.record_snapshot),
  );

const toEntity = (row: typeof app_session_approvals.$inferSelect): Approval => ({
  id: row.id,
  sessionId: row.session_id,
  flowId: row.flow_id,
  nodeId: row.node_id,
  messageId: row.message_id ?? null,
  requestedByUserId: row.requested_by_user_id,
  approverSource: row.approver_source,
  suggestedApproverUserId: row.suggested_approver_user_id ?? null,
  approverUserId: row.approver_user_id ?? null,
  approverEmail: row.approver_email ?? null,
  isOverride: row.is_override,
  status: row.status,
  decidedByUserId: row.decided_by_user_id ?? null,
  decidedAt: row.decided_at ?? null,
  comment: row.comment ?? null,
  requestMessage: row.request_message ?? null,
  recordSnapshot: (row.record_snapshot as Record<string, unknown> | null) ?? null,
  offSystemApprovedOn: row.off_system_approved_on ?? null,
  offSystemEvidenceFilename: row.off_system_evidence_filename ?? null,
  offSystemEvidenceMimeType: row.off_system_evidence_mime_type ?? null,
  offSystemEvidenceSizeBytes: row.off_system_evidence_size_bytes ?? null,
  offSystemEvidenceStoragePath: row.off_system_evidence_storage_path ?? null,
  offSystemNominatedByUserId: row.off_system_nominated_by_user_id ?? null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleApprovalRepository implements IApprovalRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewApproval): Promise<Result<Approval>> {
    try {
      const [row] = await this.db
        .insert(app_session_approvals)
        .values({
          session_id: input.sessionId,
          flow_id: input.flowId,
          node_id: input.nodeId,
          message_id: input.messageId ?? null,
          requested_by_user_id: input.requestedByUserId,
          approver_source: input.approverSource,
          suggested_approver_user_id: input.suggestedApproverUserId ?? null,
          approver_user_id: input.approverUserId ?? null,
          approver_email: input.approverEmail ?? null,
          is_override: input.isOverride ?? false,
          status: input.status ?? "pending",
          request_message: input.requestMessage ?? null,
          record_snapshot: input.recordSnapshot ?? null,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Approval insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create approval.", cause));
    }
  }

  async findById(id: string): Promise<Result<Approval | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_session_approvals)
        .where(eq(app_session_approvals.id, id));
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find approval.", cause));
    }
  }

  async findPendingByNode(sessionId: string, nodeId: string): Promise<Result<Approval | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_session_approvals)
        .where(
          and(
            eq(app_session_approvals.session_id, sessionId),
            eq(app_session_approvals.node_id, nodeId),
            eq(app_session_approvals.status, "pending"),
          ),
        )
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find pending approval.", cause));
    }
  }

  // Who this approval is currently routed to. An email-only assignment
  // (ADR-018) is raised before the recipient has an account, so the address is
  // matched alongside the id.
  private assigneeMatch(input: ApproverQuery) {
    if (!input.approverEmail) {
      return eq(app_session_approvals.approver_user_id, input.approverUserId);
    }
    return or(
      eq(app_session_approvals.approver_user_id, input.approverUserId),
      eq(app_session_approvals.approver_email, input.approverEmail),
    );
  }

  async listPendingForApprover(input: ApproverQuery): Promise<Result<Approval[]>> {
    try {
      // Joined rather than filtered after the fact: an approval on a discarded
      // session must never reach the queue, and the join also keeps the read to
      // one round trip.
      const rows = await this.db
        .select({ approval: app_session_approvals })
        .from(app_session_approvals)
        .innerJoin(app_sessions, eq(app_sessions.id, app_session_approvals.session_id))
        .where(
          and(
            this.assigneeMatch(input),
            eq(app_session_approvals.status, "pending"),
            // An approval raised by a test run resolves to the testing author,
            // never a real supervisor — so it must not reach any queue (ADR-048 §5).
            eq(app_sessions.mode, "live"),
            notInArray(app_sessions.status, [...DISCARDED_SESSION_STATUSES]),
          ),
        )
        .orderBy(desc(app_session_approvals.created_at));
      return ok(rows.map((row) => toEntity(row.approval)));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list pending approvals.", cause));
    }
  }

  async listForApprover(
    input: ApproverQuery & { scope: ApprovalListScope },
  ): Promise<Result<Approval[]>> {
    if (input.scope === "pending") return this.listPendingForApprover(input);

    try {
      // A decision belongs to whoever made it, so a row reassigned after the
      // fact still appears in the decider's history. Discarded sessions are not
      // filtered here: a decision that was made is a matter of record, and the
      // detail page reports the session's real state alongside it.
      const decidedMatch = and(
        ne(app_session_approvals.status, "pending"),
        or(
          this.assigneeMatch(input),
          eq(app_session_approvals.decided_by_user_id, input.approverUserId),
        ),
      );
      const pendingMatch = and(
        eq(app_session_approvals.status, "pending"),
        this.assigneeMatch(input),
        eq(app_sessions.mode, "live"),
        notInArray(app_sessions.status, [...DISCARDED_SESSION_STATUSES]),
      );

      const rows = await this.db
        .select({ approval: app_session_approvals })
        .from(app_session_approvals)
        .innerJoin(app_sessions, eq(app_sessions.id, app_session_approvals.session_id))
        .where(input.scope === "decided" ? decidedMatch : or(decidedMatch, pendingMatch))
        .orderBy(desc(app_session_approvals.created_at));
      return ok(rows.map((row) => toEntity(row.approval)));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list approvals.", cause));
    }
  }

  async listBySession(sessionId: string): Promise<Result<Approval[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_session_approvals)
        .where(eq(app_session_approvals.session_id, sessionId))
        .orderBy(desc(app_session_approvals.created_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list approvals for session.", cause));
    }
  }

  async hasRecordedSnapshot(sessionId: string): Promise<Result<boolean>> {
    try {
      const [row] = await this.db
        .select({ id: app_session_approvals.id })
        .from(app_session_approvals)
        .where(recordedSnapshotWhere(sessionId))
        .limit(1);
      return ok(Boolean(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to check approval snapshot.", cause));
    }
  }

  async update(id: string, patch: ApprovalUpdate): Promise<Result<Approval>> {
    try {
      const [row] = await this.db
        .update(app_session_approvals)
        .set(this.patchToColumns(patch))
        .where(eq(app_session_approvals.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Approval ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update approval.", cause));
    }
  }

  async updateIfPending(id: string, patch: ApprovalUpdate): Promise<Result<Approval | null>> {
    try {
      // The status='pending' predicate makes the guard atomic: a concurrent
      // decider that already flipped the row out of pending matches no row here,
      // so its rival gets null and skips the decision side effects.
      const [row] = await this.db
        .update(app_session_approvals)
        .set(this.patchToColumns(patch))
        .where(and(eq(app_session_approvals.id, id), eq(app_session_approvals.status, "pending")))
        .returning();
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update approval.", cause));
    }
  }

  private patchToColumns(patch: ApprovalUpdate): Record<string, unknown> {
    return approvalPatchToColumns(patch);
  }
}

// The column mapping, pure and exported so the jsonb round-trip can be asserted
// without a database. `record_snapshot` is written whole: the step-prefixed
// report keys, the resolved subject and the frozen attestation all ride the
// existing column, so extending the record needs no migration (ADR-040 §4).
export const approvalPatchToColumns = (patch: ApprovalUpdate): Record<string, unknown> => {
  return {
      ...(patch.approverUserId !== undefined ? { approver_user_id: patch.approverUserId } : {}),
      ...(patch.approverEmail !== undefined ? { approver_email: patch.approverEmail } : {}),
      ...(patch.isOverride !== undefined ? { is_override: patch.isOverride } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.decidedByUserId !== undefined
        ? { decided_by_user_id: patch.decidedByUserId }
        : {}),
      ...(patch.decidedAt !== undefined ? { decided_at: patch.decidedAt } : {}),
      ...(patch.comment !== undefined ? { comment: patch.comment } : {}),
      ...(patch.requestMessage !== undefined ? { request_message: patch.requestMessage } : {}),
      ...(patch.recordSnapshot !== undefined ? { record_snapshot: patch.recordSnapshot } : {}),
      ...(patch.offSystemApprovedOn !== undefined
        ? { off_system_approved_on: patch.offSystemApprovedOn }
        : {}),
      // The evidence is one fact in five columns, so it is written and cleared
      // as a unit — a patch that set the path but left a stale filename behind
      // would describe a file that is not there.
      ...(patch.offSystemEvidence !== undefined
        ? {
            off_system_evidence_filename: patch.offSystemEvidence?.filename ?? null,
            off_system_evidence_mime_type: patch.offSystemEvidence?.mimeType ?? null,
            off_system_evidence_size_bytes: patch.offSystemEvidence?.sizeBytes ?? null,
            off_system_evidence_storage_path: patch.offSystemEvidence?.storagePath ?? null,
          }
        : {}),
      ...(patch.offSystemNominatedByUserId !== undefined
        ? { off_system_nominated_by_user_id: patch.offSystemNominatedByUserId }
        : {}),
      updated_at: new Date(),
  };
};
