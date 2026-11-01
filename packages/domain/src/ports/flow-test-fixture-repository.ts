import type {
  FlowTestFixture,
  FlowTestFixtureUpdate,
  NewFlowTestFixture,
} from "../entities/flow-test-fixture";
import type { Result } from "../result";

// A fixture cloned from a live session can hold real personal or commercially
// sensitive values, so every read is scoped to the requesting user rather than
// to the flow. The scoping lives here, in the repository, for the same reason
// the `mode` predicate does: a router-level check is correct until the next
// caller forgets it (ADR-048 §4).
export interface IFlowTestFixtureRepository {
  listByFlow(flowId: string, userId: string): Promise<Result<FlowTestFixture[]>>;
  findById(id: string, userId: string): Promise<Result<FlowTestFixture | null>>;
  create(input: NewFlowTestFixture): Promise<Result<FlowTestFixture>>;
  update(id: string, userId: string, patch: FlowTestFixtureUpdate): Promise<Result<FlowTestFixture>>;
  delete(id: string, userId: string): Promise<Result<void>>;
}
