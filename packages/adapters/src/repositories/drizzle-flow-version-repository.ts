import {
  domainError,
  err,
  ok,
  type CreatePublishedVersion,
  type FlowVersion,
  type FlowVersionSummary,
  type IFlowVersionRepository,
  type RestoreVersion,
  type Result,
  type UpsertDraftVersion,
} from "@rbrasier/domain";
import { and, desc, eq, max, notInArray } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_flow_edges, app_flow_nodes, app_flow_versions, app_flows } from "../db/schema/wayfinder";
import { logRepoError } from "./log-repo-error";

type VersionRow = typeof app_flow_versions.$inferSelect;
// A transaction handle exposes the same query surface the repository uses.
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const toEntity = (row: VersionRow): FlowVersion => ({
  id: row.id,
  flowId: row.flow_id,
  versionNumber: row.version_number,
  status: row.status,
  snapshot: row.snapshot,
  changeSummary: row.change_summary,
  publishedByUserId: row.published_by_user_id,
  publishedAt: row.published_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toSummary = (row: Omit<VersionRow, "snapshot">): FlowVersionSummary => ({
  id: row.id,
  flowId: row.flow_id,
  versionNumber: row.version_number,
  status: row.status,
  changeSummary: row.change_summary,
  publishedByUserId: row.published_by_user_id,
  publishedAt: row.published_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const nextVersionNumber = async (tx: Tx, flowId: string): Promise<number> => {
  const [row] = await tx
    .select({ highest: max(app_flow_versions.version_number) })
    .from(app_flow_versions)
    .where(and(eq(app_flow_versions.flow_id, flowId), eq(app_flow_versions.status, "published")));
  return (row?.highest ?? 0) + 1;
};

const findOpenDraft = async (tx: Tx, flowId: string): Promise<VersionRow | undefined> => {
  const [row] = await tx
    .select()
    .from(app_flow_versions)
    .where(and(eq(app_flow_versions.flow_id, flowId), eq(app_flow_versions.status, "draft")));
  return row;
};

export class DrizzleFlowVersionRepository implements IFlowVersionRepository {
  constructor(private readonly db: Database) {}

  async createPublished(input: CreatePublishedVersion): Promise<Result<FlowVersion>> {
    try {
      const version = await this.db.transaction(async (tx) => {
        const versionNumber = await nextVersionNumber(tx, input.flowId);
        const draft = await findOpenDraft(tx, input.flowId);
        const now = new Date();

        if (draft) {
          const [row] = await tx
            .update(app_flow_versions)
            .set({
              status: "published",
              version_number: versionNumber,
              snapshot: input.snapshot,
              change_summary: input.changeSummary ?? null,
              published_by_user_id: input.publishedByUserId,
              published_at: now,
              updated_at: now,
            })
            .where(eq(app_flow_versions.id, draft.id))
            .returning();
          return row;
        }

        const [row] = await tx
          .insert(app_flow_versions)
          .values({
            flow_id: input.flowId,
            version_number: versionNumber,
            status: "published",
            snapshot: input.snapshot,
            change_summary: input.changeSummary ?? null,
            published_by_user_id: input.publishedByUserId,
            published_at: now,
          })
          .returning();
        return row;
      });
      if (!version) return err(domainError("INFRA_FAILURE", "Publish returned no row."));
      return ok(toEntity(version));
    } catch (cause) {
      logRepoError("DrizzleFlowVersionRepository.createPublished", cause);
      return err(domainError("INFRA_FAILURE", "Failed to publish flow version.", cause));
    }
  }

  async upsertDraft(input: UpsertDraftVersion): Promise<Result<FlowVersion>> {
    try {
      const version = await this.db.transaction(async (tx) => {
        const draft = await findOpenDraft(tx, input.flowId);
        const now = new Date();

        if (draft) {
          const [row] = await tx
            .update(app_flow_versions)
            .set({
              snapshot: input.snapshot,
              ...(input.changeSummary !== undefined ? { change_summary: input.changeSummary } : {}),
              updated_at: now,
            })
            .where(eq(app_flow_versions.id, draft.id))
            .returning();
          return row;
        }

        const [row] = await tx
          .insert(app_flow_versions)
          .values({
            flow_id: input.flowId,
            version_number: null,
            status: "draft",
            snapshot: input.snapshot,
            change_summary: input.changeSummary ?? null,
          })
          .returning();
        return row;
      });
      if (!version) return err(domainError("INFRA_FAILURE", "Draft upsert returned no row."));
      return ok(toEntity(version));
    } catch (cause) {
      logRepoError("DrizzleFlowVersionRepository.upsertDraft", cause);
      return err(domainError("INFRA_FAILURE", "Failed to upsert flow draft.", cause));
    }
  }

  async restore(input: RestoreVersion): Promise<Result<FlowVersion>> {
    try {
      const version = await this.db.transaction(async (tx) => {
        const now = new Date();
        const { flow, nodes, edges } = input.snapshot;

        await tx
          .update(app_flows)
          .set({
            name: flow.name,
            description: flow.description,
            icon: flow.icon,
            expert_role: flow.expertRole,
            context_docs: flow.contextDocs.map((doc) => ({
              id: doc.id,
              filename: doc.filename,
              mimeType: doc.mimeType,
              sizeBytes: doc.sizeBytes,
              storagePath: doc.storagePath,
            })),
            updated_at: now,
          })
          .where(eq(app_flows.id, input.flowId));

        // Upsert nodes by their captured id rather than delete-and-recreate, so
        // session rows that reference a surviving node (step outputs, schedules,
        // approvals) are not cascade-deleted on restore.
        for (const node of nodes) {
          await tx
            .insert(app_flow_nodes)
            .values({
              id: node.id,
              flow_id: input.flowId,
              type: node.type,
              name: node.name,
              colour: node.colour,
              position_x: node.positionX,
              position_y: node.positionY,
              config: node.config,
              updated_at: now,
            })
            .onConflictDoUpdate({
              target: app_flow_nodes.id,
              set: {
                type: node.type,
                name: node.name,
                colour: node.colour,
                position_x: node.positionX,
                position_y: node.positionY,
                config: node.config,
                updated_at: now,
              },
            });
        }

        const keptNodeIds = nodes.map((node) => node.id);
        await tx
          .delete(app_flow_nodes)
          .where(
            keptNodeIds.length > 0
              ? and(
                  eq(app_flow_nodes.flow_id, input.flowId),
                  notInArray(app_flow_nodes.id, keptNodeIds),
                )
              : eq(app_flow_nodes.flow_id, input.flowId),
          );

        await tx.delete(app_flow_edges).where(eq(app_flow_edges.flow_id, input.flowId));
        if (edges.length > 0) {
          await tx.insert(app_flow_edges).values(
            edges.map((edge) => ({
              id: edge.id,
              flow_id: input.flowId,
              from_node_id: edge.fromNodeId,
              to_node_id: edge.toNodeId,
              updated_at: now,
            })),
          );
        }

        // A restore makes the live definition match the chosen version exactly,
        // so any open draft (edits captured before the restore) is now stale.
        // Drop it: the next edit opens a fresh draft that sorts to the top of
        // history rather than reusing the pre-restore draft's older timestamp.
        await tx
          .delete(app_flow_versions)
          .where(and(eq(app_flow_versions.flow_id, input.flowId), eq(app_flow_versions.status, "draft")));

        const versionNumber = await nextVersionNumber(tx, input.flowId);
        const [row] = await tx
          .insert(app_flow_versions)
          .values({
            flow_id: input.flowId,
            version_number: versionNumber,
            status: "published",
            snapshot: input.snapshot,
            change_summary:
              input.changeSummary ?? `Restored from version ${input.sourceVersionNumber}`,
            published_by_user_id: input.publishedByUserId,
            published_at: now,
          })
          .returning();
        return row;
      });
      if (!version) return err(domainError("INFRA_FAILURE", "Restore returned no row."));
      return ok(toEntity(version));
    } catch (cause) {
      logRepoError("DrizzleFlowVersionRepository.restore", cause);
      return err(domainError("INFRA_FAILURE", "Failed to restore flow version.", cause));
    }
  }

  async listForFlow(flowId: string): Promise<Result<FlowVersionSummary[]>> {
    try {
      const rows = await this.db
        .select({
          id: app_flow_versions.id,
          flow_id: app_flow_versions.flow_id,
          version_number: app_flow_versions.version_number,
          status: app_flow_versions.status,
          change_summary: app_flow_versions.change_summary,
          published_by_user_id: app_flow_versions.published_by_user_id,
          published_at: app_flow_versions.published_at,
          created_at: app_flow_versions.created_at,
          updated_at: app_flow_versions.updated_at,
        })
        .from(app_flow_versions)
        .where(eq(app_flow_versions.flow_id, flowId))
        .orderBy(desc(app_flow_versions.created_at));
      return ok(rows.map(toSummary));
    } catch (cause) {
      logRepoError("DrizzleFlowVersionRepository.listForFlow", cause);
      return err(domainError("INFRA_FAILURE", "Failed to list flow versions.", cause));
    }
  }

  async getById(id: string): Promise<Result<FlowVersion | null>> {
    try {
      const [row] = await this.db.select().from(app_flow_versions).where(eq(app_flow_versions.id, id));
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      logRepoError("DrizzleFlowVersionRepository.getById", cause);
      return err(domainError("INFRA_FAILURE", "Failed to get flow version.", cause));
    }
  }

  async getByNumber(flowId: string, versionNumber: number): Promise<Result<FlowVersion | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_flow_versions)
        .where(
          and(
            eq(app_flow_versions.flow_id, flowId),
            eq(app_flow_versions.version_number, versionNumber),
          ),
        );
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      logRepoError("DrizzleFlowVersionRepository.getByNumber", cause);
      return err(domainError("INFRA_FAILURE", "Failed to get flow version by number.", cause));
    }
  }

  async latestPublished(flowId: string): Promise<Result<FlowVersion | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_flow_versions)
        .where(
          and(eq(app_flow_versions.flow_id, flowId), eq(app_flow_versions.status, "published")),
        )
        .orderBy(desc(app_flow_versions.version_number))
        .limit(1);
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      logRepoError("DrizzleFlowVersionRepository.latestPublished", cause);
      return err(domainError("INFRA_FAILURE", "Failed to get latest published version.", cause));
    }
  }

  async openDraft(flowId: string): Promise<Result<FlowVersion | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_flow_versions)
        .where(and(eq(app_flow_versions.flow_id, flowId), eq(app_flow_versions.status, "draft")));
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      logRepoError("DrizzleFlowVersionRepository.openDraft", cause);
      return err(domainError("INFRA_FAILURE", "Failed to get open draft.", cause));
    }
  }
}
