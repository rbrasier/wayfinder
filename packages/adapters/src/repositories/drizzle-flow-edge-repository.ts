import {
  domainError,
  err,
  ok,
  type FlowEdge,
  type IFlowEdgeRepository,
  type NewFlowEdge,
  type Result,
} from "@rbrasier/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_flow_edges } from "../db/schema/wayfinder";

const toEntity = (row: typeof app_flow_edges.$inferSelect): FlowEdge => ({
  id: row.id,
  flowId: row.flow_id,
  fromNodeId: row.from_node_id,
  toNodeId: row.to_node_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleFlowEdgeRepository implements IFlowEdgeRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewFlowEdge): Promise<Result<FlowEdge>> {
    try {
      const [row] = await this.db
        .insert(app_flow_edges)
        .values({
          flow_id: input.flowId,
          from_node_id: input.fromNodeId,
          to_node_id: input.toNodeId,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Edge insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create flow edge.", cause));
    }
  }

  async listByFlow(flowId: string): Promise<Result<FlowEdge[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_flow_edges)
        .where(eq(app_flow_edges.flow_id, flowId));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list flow edges.", cause));
    }
  }

  async delete(id: string): Promise<Result<true>> {
    try {
      await this.db.delete(app_flow_edges).where(eq(app_flow_edges.id, id));
      return ok(true as const);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to delete flow edge.", cause));
    }
  }
}
