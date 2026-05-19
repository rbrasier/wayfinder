import {
  domainError,
  err,
  ok,
  type Flow,
  type FlowContextDoc,
  type FlowPermissionRole,
  type FlowUpdate,
  type IFlowRepository,
  type NewFlow,
  type Result,
} from "@rbrasier/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_flows } from "../db/schema/wayfinder";

const toEntity = (row: typeof app_flows.$inferSelect): Flow => ({
  id: row.id,
  name: row.name,
  description: row.description,
  icon: row.icon,
  ownerUserId: row.owner_user_id,
  status: row.status,
  permissions: row.permissions,
  contextDocs: row.context_docs,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleFlowRepository implements IFlowRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewFlow): Promise<Result<Flow>> {
    try {
      const [row] = await this.db
        .insert(app_flows)
        .values({
          name: input.name,
          description: input.description ?? null,
          icon: input.icon ?? null,
          owner_user_id: input.ownerUserId,
          status: "draft",
          permissions: [{ userId: input.ownerUserId, role: "owner" }],
          context_docs: [],
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Flow insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create flow.", cause));
    }
  }

  async findById(id: string): Promise<Result<Flow | null>> {
    try {
      const [row] = await this.db.select().from(app_flows).where(eq(app_flows.id, id));
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find flow.", cause));
    }
  }

  async list(): Promise<Result<Flow[]>> {
    try {
      const rows = await this.db.select().from(app_flows).orderBy(app_flows.updated_at);
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list flows.", cause));
    }
  }

  async listForUser(userId: string): Promise<Result<Flow[]>> {
    try {
      const rows = await this.db.select().from(app_flows).where(eq(app_flows.owner_user_id, userId));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list flows for user.", cause));
    }
  }

  async update(id: string, patch: FlowUpdate): Promise<Result<Flow>> {
    try {
      const [row] = await this.db
        .update(app_flows)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.ownerUserId !== undefined ? { owner_user_id: patch.ownerUserId } : {}),
          updated_at: new Date(),
        })
        .where(eq(app_flows.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Flow ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update flow.", cause));
    }
  }

  async addContextDoc(flowId: string, doc: FlowContextDoc): Promise<Result<Flow>> {
    try {
      const [current] = await this.db.select().from(app_flows).where(eq(app_flows.id, flowId));
      if (!current) return err(domainError("NOT_FOUND", `Flow ${flowId} not found.`));
      const [row] = await this.db
        .update(app_flows)
        .set({ context_docs: [...current.context_docs, doc], updated_at: new Date() })
        .where(eq(app_flows.id, flowId))
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Context doc update returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to add context doc.", cause));
    }
  }

  async removeContextDoc(flowId: string, docId: string): Promise<Result<Flow>> {
    try {
      const [current] = await this.db.select().from(app_flows).where(eq(app_flows.id, flowId));
      if (!current) return err(domainError("NOT_FOUND", `Flow ${flowId} not found.`));
      const [row] = await this.db
        .update(app_flows)
        .set({ context_docs: current.context_docs.filter((d) => d.id !== docId), updated_at: new Date() })
        .where(eq(app_flows.id, flowId))
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Context doc remove returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to remove context doc.", cause));
    }
  }

  async setPermission(flowId: string, userId: string, role: FlowPermissionRole): Promise<Result<Flow>> {
    try {
      const [current] = await this.db.select().from(app_flows).where(eq(app_flows.id, flowId));
      if (!current) return err(domainError("NOT_FOUND", `Flow ${flowId} not found.`));
      const permissions = current.permissions.filter((p) => p.userId !== userId);
      permissions.push({ userId, role });
      const [row] = await this.db
        .update(app_flows)
        .set({ permissions, updated_at: new Date() })
        .where(eq(app_flows.id, flowId))
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Permission update returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to set permission.", cause));
    }
  }
}
