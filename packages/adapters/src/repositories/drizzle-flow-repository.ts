import {
  domainError,
  err,
  ok,
  type ExtractionStatus,
  type Flow,
  type FlowContextDoc,
  type FlowPermissionRole,
  type FlowUpdate,
  type IFlowRepository,
  type NewFlow,
  type Result,
} from "@rbrasier/domain";
import { desc, eq, inArray, isNull } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_flows, kb_context_doc_content } from "../db/schema/wayfinder";
import { logRepoError } from "./log-repo-error";

type StoredContextDoc = typeof app_flows.$inferSelect["context_docs"][number];
type ContentRow = typeof kb_context_doc_content.$inferSelect;

const toContextDoc = (stored: StoredContextDoc, content?: ContentRow): FlowContextDoc => ({
  id: stored.id,
  filename: stored.filename,
  mimeType: stored.mimeType,
  sizeBytes: stored.sizeBytes,
  storagePath: stored.storagePath,
  extractedText: content?.extracted_text ?? null,
  extractionStatus: (content?.extraction_status ?? "pending") as ExtractionStatus,
});

const toEntity = (row: typeof app_flows.$inferSelect, contentRows: ContentRow[] = []): Flow => {
  const contentByPath = new Map(contentRows.map((r) => [r.storage_path, r]));
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    expertRole: row.expert_role ?? null,
    ownerUserId: row.owner_user_id,
    status: row.status,
    visibility: row.visibility,
    permissions: row.permissions,
    contextDocs: row.context_docs.map((d) => toContextDoc(d, contentByPath.get(d.storagePath))),
    deletedAt: row.deleted_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

export class DrizzleFlowRepository implements IFlowRepository {
  constructor(private readonly db: Database) {}

  private async enrichContextDocs(storedDocs: StoredContextDoc[]): Promise<ContentRow[]> {
    if (storedDocs.length === 0) return [];
    const paths = storedDocs.map((d) => d.storagePath);
    return this.db
      .select()
      .from(kb_context_doc_content)
      .where(inArray(kb_context_doc_content.storage_path, paths));
  }

  async create(input: NewFlow): Promise<Result<Flow>> {
    try {
      const [row] = await this.db
        .insert(app_flows)
        .values({
          name: input.name,
          description: input.description ?? null,
          icon: input.icon ?? null,
          expert_role: input.expertRole ?? null,
          owner_user_id: input.ownerUserId,
          status: "draft",
          visibility: { kind: "private" },
          permissions: [{ userId: input.ownerUserId, role: "owner" }],
          context_docs: [],
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Flow insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      logRepoError("DrizzleFlowRepository.create", cause);
      return err(domainError("INFRA_FAILURE", "Failed to create flow.", cause));
    }
  }

  async findById(id: string): Promise<Result<Flow | null>> {
    try {
      const [row] = await this.db.select().from(app_flows).where(eq(app_flows.id, id));
      if (!row) return ok(null);
      const contentRows = await this.enrichContextDocs(row.context_docs);
      return ok(toEntity(row, contentRows));
    } catch (cause) {
      logRepoError("DrizzleFlowRepository.findById", cause);
      return err(domainError("INFRA_FAILURE", "Failed to find flow.", cause));
    }
  }

  async list(): Promise<Result<Flow[]>> {
    try {
      const rows = await this.db.select().from(app_flows).where(isNull(app_flows.deleted_at)).orderBy(desc(app_flows.updated_at));
      return ok(rows.map((r) => toEntity(r)));
    } catch (cause) {
      logRepoError("DrizzleFlowRepository.list", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list flows.", cause));
    }
  }

  async listForUser(userId: string): Promise<Result<Flow[]>> {
    try {
      const rows = await this.db.select().from(app_flows).where(eq(app_flows.owner_user_id, userId)).orderBy(desc(app_flows.updated_at));
      const nonDeleted = rows.filter((r) => r.deleted_at === null);
      return ok(nonDeleted.map((r) => toEntity(r)));
    } catch (cause) {
      logRepoError("DrizzleFlowRepository.listForUser", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list flows for user.", cause));
    }
  }

  async softDelete(id: string): Promise<Result<Flow>> {
    try {
      const [row] = await this.db
        .update(app_flows)
        .set({ deleted_at: new Date(), updated_at: new Date() })
        .where(eq(app_flows.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Flow ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      logRepoError("DrizzleFlowRepository.softDelete", cause);
      return err(domainError("INFRA_FAILURE", "Failed to delete flow.", cause));
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
          ...(patch.expertRole !== undefined ? { expert_role: patch.expertRole } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
          ...(patch.ownerUserId !== undefined ? { owner_user_id: patch.ownerUserId } : {}),
          updated_at: new Date(),
        })
        .where(eq(app_flows.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Flow ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      logRepoError("DrizzleFlowRepository.update", cause);
      return err(domainError("INFRA_FAILURE", "Failed to update flow.", cause));
    }
  }

  async addContextDoc(flowId: string, doc: FlowContextDoc): Promise<Result<Flow>> {
    try {
      const [current] = await this.db.select().from(app_flows).where(eq(app_flows.id, flowId));
      if (!current) return err(domainError("NOT_FOUND", `Flow ${flowId} not found.`));
      const storedDoc: StoredContextDoc = {
        id: doc.id,
        filename: doc.filename,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        storagePath: doc.storagePath,
      };
      const [row] = await this.db
        .update(app_flows)
        .set({ context_docs: [...current.context_docs, storedDoc], updated_at: new Date() })
        .where(eq(app_flows.id, flowId))
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Context doc update returned no row."));
      const contentRows = await this.enrichContextDocs(row.context_docs);
      return ok(toEntity(row, contentRows));
    } catch (cause) {
      logRepoError("DrizzleFlowRepository.addContextDoc", cause);
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
      logRepoError("DrizzleFlowRepository.removeContextDoc", cause);
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
      logRepoError("DrizzleFlowRepository.setPermission", cause);
      return err(domainError("INFRA_FAILURE", "Failed to set permission.", cause));
    }
  }
}
