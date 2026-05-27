import {
  domainError,
  err,
  ok,
  type FlowNode,
  type FlowNodeUpdate,
  type IFlowNodeRepository,
  type NewFlowNode,
  type Result,
} from "@rbrasier/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { app_flow_nodes } from "../db/schema/wayfinder";

const toEntity = (row: typeof app_flow_nodes.$inferSelect): FlowNode => ({
  id: row.id,
  flowId: row.flow_id,
  type: row.type,
  name: row.name,
  colour: row.colour,
  positionX: row.position_x,
  positionY: row.position_y,
  config: row.config,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export class DrizzleFlowNodeRepository implements IFlowNodeRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewFlowNode): Promise<Result<FlowNode>> {
    try {
      const [row] = await this.db
        .insert(app_flow_nodes)
        .values({
          flow_id: input.flowId,
          type: input.type,
          name: input.name,
          colour: input.colour ?? null,
          position_x: Math.round(input.positionX),
          position_y: Math.round(input.positionY),
          config: input.config,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Node insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create flow node.", cause));
    }
  }

  async findById(id: string): Promise<Result<FlowNode | null>> {
    try {
      const [row] = await this.db.select().from(app_flow_nodes).where(eq(app_flow_nodes.id, id));
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find flow node.", cause));
    }
  }

  async listByFlow(flowId: string): Promise<Result<FlowNode[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_flow_nodes)
        .where(eq(app_flow_nodes.flow_id, flowId));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list flow nodes.", cause));
    }
  }

  async update(id: string, patch: FlowNodeUpdate): Promise<Result<FlowNode>> {
    try {
      const [row] = await this.db
        .update(app_flow_nodes)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.colour !== undefined ? { colour: patch.colour } : {}),
          ...(patch.config !== undefined ? { config: patch.config } : {}),
          updated_at: new Date(),
        })
        .where(eq(app_flow_nodes.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Node ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update flow node.", cause));
    }
  }

  async updatePosition(id: string, x: number, y: number): Promise<Result<FlowNode>> {
    try {
      const [row] = await this.db
        .update(app_flow_nodes)
        .set({ position_x: Math.round(x), position_y: Math.round(y), updated_at: new Date() })
        .where(eq(app_flow_nodes.id, id))
        .returning();
      if (!row) return err(domainError("NOT_FOUND", `Node ${id} not found.`));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update node position.", cause));
    }
  }

  async delete(id: string): Promise<Result<true>> {
    try {
      await this.db.delete(app_flow_nodes).where(eq(app_flow_nodes.id, id));
      return ok(true as const);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to delete flow node.", cause));
    }
  }
}
