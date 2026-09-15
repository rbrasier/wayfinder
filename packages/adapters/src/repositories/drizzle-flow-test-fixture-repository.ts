import { and, desc, eq } from "drizzle-orm";
import {
  domainError,
  err,
  ok,
  type FlowTestFixture,
  type FlowTestFixtureUpdate,
  type IFlowTestFixtureRepository,
  type NewFlowTestFixture,
  type Result,
} from "@wayfinder/domain";
import type { Database } from "../db/client";
import { app_flow_test_fixtures } from "../db/schema/wayfinder";

const toEntity = (row: typeof app_flow_test_fixtures.$inferSelect): FlowTestFixture => ({
  id: row.id,
  flowId: row.flow_id,
  name: row.name,
  startNodeId: row.start_node_id,
  gatheredContext: row.gathered_context,
  stepOutputs: row.step_outputs,
  createdByUserId: row.created_by_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Every read and write carries the requesting user, and the ownership check is
// part of the SQL rather than a branch after the fetch (ADR-048). A fixture
// cloned from a live session can hold real personal data, so "not yours" and
// "not found" have to be the same answer — a check performed after loading the
// row would still have loaded it.
export class DrizzleFlowTestFixtureRepository implements IFlowTestFixtureRepository {
  constructor(private readonly db: Database) {}

  async listByFlow(flowId: string, userId: string): Promise<Result<FlowTestFixture[]>> {
    try {
      const rows = await this.db
        .select()
        .from(app_flow_test_fixtures)
        .where(
          and(
            eq(app_flow_test_fixtures.flow_id, flowId),
            eq(app_flow_test_fixtures.created_by_user_id, userId),
          ),
        )
        .orderBy(desc(app_flow_test_fixtures.updated_at));
      return ok(rows.map(toEntity));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to list flow test fixtures.", cause));
    }
  }

  async findById(id: string, userId: string): Promise<Result<FlowTestFixture | null>> {
    try {
      const [row] = await this.db
        .select()
        .from(app_flow_test_fixtures)
        .where(
          and(
            eq(app_flow_test_fixtures.id, id),
            eq(app_flow_test_fixtures.created_by_user_id, userId),
          ),
        );
      return ok(row ? toEntity(row) : null);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to find flow test fixture.", cause));
    }
  }

  async create(input: NewFlowTestFixture): Promise<Result<FlowTestFixture>> {
    try {
      const [row] = await this.db
        .insert(app_flow_test_fixtures)
        .values({
          flow_id: input.flowId,
          name: input.name,
          start_node_id: input.startNodeId,
          gathered_context: input.gatheredContext,
          step_outputs: input.stepOutputs,
          created_by_user_id: input.createdByUserId,
        })
        .returning();
      if (!row) return err(domainError("INFRA_FAILURE", "Fixture insert returned no row."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to create flow test fixture.", cause));
    }
  }

  async update(
    id: string,
    userId: string,
    patch: FlowTestFixtureUpdate,
  ): Promise<Result<FlowTestFixture>> {
    try {
      const [row] = await this.db
        .update(app_flow_test_fixtures)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.startNodeId !== undefined ? { start_node_id: patch.startNodeId } : {}),
          ...(patch.gatheredContext !== undefined
            ? { gathered_context: patch.gatheredContext }
            : {}),
          ...(patch.stepOutputs !== undefined ? { step_outputs: patch.stepOutputs } : {}),
          updated_at: new Date(),
        })
        .where(
          and(
            eq(app_flow_test_fixtures.id, id),
            eq(app_flow_test_fixtures.created_by_user_id, userId),
          ),
        )
        .returning();
      if (!row) return err(domainError("NOT_FOUND", "Flow test fixture not found."));
      return ok(toEntity(row));
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to update flow test fixture.", cause));
    }
  }

  async delete(id: string, userId: string): Promise<Result<void>> {
    try {
      const rows = await this.db
        .delete(app_flow_test_fixtures)
        .where(
          and(
            eq(app_flow_test_fixtures.id, id),
            eq(app_flow_test_fixtures.created_by_user_id, userId),
          ),
        )
        .returning();
      if (rows.length === 0) return err(domainError("NOT_FOUND", "Flow test fixture not found."));
      return ok(undefined);
    } catch (cause) {
      return err(domainError("INFRA_FAILURE", "Failed to delete flow test fixture.", cause));
    }
  }
}
