import type { FlowSnapshot, FlowVersion, FlowVersionSummary } from "../entities/flow-version";
import type { Result } from "../result";

export interface CreatePublishedVersion {
  flowId: string;
  snapshot: FlowSnapshot;
  publishedByUserId: string;
  changeSummary?: string | null;
}

export interface UpsertDraftVersion {
  flowId: string;
  snapshot: FlowSnapshot;
  changeSummary?: string | null;
}

export interface RestoreVersion {
  flowId: string;
  snapshot: FlowSnapshot;
  sourceVersionNumber: number;
  publishedByUserId: string;
  changeSummary?: string | null;
}

export interface IFlowVersionRepository {
  // Promotes the open draft (if any) to `published`, otherwise inserts a fresh
  // published row. Allocates the next `version_number` for the flow atomically.
  createPublished(input: CreatePublishedVersion): Promise<Result<FlowVersion>>;
  // Opens the single draft for a flow, or updates its snapshot if one is open.
  upsertDraft(input: UpsertDraftVersion): Promise<Result<FlowVersion>>;
  // Rewrites the live flow/nodes/edges from the snapshot (preserving node ids)
  // and records a new published version. Non-destructive — no prior row mutated.
  restore(input: RestoreVersion): Promise<Result<FlowVersion>>;
  listForFlow(flowId: string): Promise<Result<FlowVersionSummary[]>>;
  getById(id: string): Promise<Result<FlowVersion | null>>;
  getByNumber(flowId: string, versionNumber: number): Promise<Result<FlowVersion | null>>;
  latestPublished(flowId: string): Promise<Result<FlowVersion | null>>;
  openDraft(flowId: string): Promise<Result<FlowVersion | null>>;
}
