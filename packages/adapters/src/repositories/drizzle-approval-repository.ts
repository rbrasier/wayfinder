import { and, desc, eq } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type Approval,
  type ApprovalUpdate,
  type IApprovalRepository,
  type NewApproval,
  type Result,
} from "@rbrasier/domain";
import type { Database } from "../db/client";
import { app_session_approvals } from "../db/schema/wayfinder";

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
  recordSnapshot: (row.record_snapshot as Record<string, unknown> | null) ?? null,
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

  async listPendingForApprover(approverUserId: string): Promise<Result<Approval[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_session_approvals)
        .where(
          and(
            eq(app_session_approvals.approver_user_id, approverUserId),
            eq(app_session_approvals.status, "pending"),
          ),
        )
        .orderBy(desc(app_session_approvals.created_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list pending approvals.", cause));
    }
  }

  async update(id: string, patch: ApprovalUpdate): Promise<Result<Approval>> {
    try {
      const [row] = await this.db
        .update(app_session_approvals)
        .set({
          ...(patch.approverUserId !== undefined
            ? { approver_user_id: patch.approverUserId }
            : {}),
          ...(patch.approverEmail !== undefined ? { approver_email: patch.approverEmail } : {}),
          ...(patch.isOverride !== undefined ? { is_override: patch.isOverride } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.decidedByUserId !== undefined
            ? { decided_by_user_id: patch.decidedByUserId }
            : {}),
          ...(patch.decidedAt !== undefined ? { decided_at: patch.decidedAt } : {}),
          ...(patch.comment !== undefined ? { comment: patch.comment } : {}),
          ...(patch.recordSnapshot !== undefined
            ? { record_snapshot: patch.recordSnapshot }
            : {}),
          updated_at: new Date(),
        })
        .where(eq(app_session_approvals.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Approval ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update approval.", cause));
    }
  }
}
