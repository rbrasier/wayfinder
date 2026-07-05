import {
  isOk,
  type CreatePublishedVersion,
  type FlowVersion,
  type FlowVersionSummary,
  type IFlowVersionRepository,
  type Result,
  type RestoreVersion,
  type UpsertDraftVersion,
} from "@rbrasier/domain";
import type { TtlCache } from "../cache/ttl-cache";

// A published flow version is a frozen snapshot (ADR-015): once created, neither
// its id nor its snapshot ever changes. Every session turn and every poll
// re-reads and re-parses that snapshot to render the pinned definition, so
// caching it by id removes a repeated DB read + JSON parse from the hot path
// (scaling wall #4). Drafts are still mutable, so they are never cached; the
// inner repository is consulted every time for them and for cache misses.
export class CachedFlowVersionRepository implements IFlowVersionRepository {
  constructor(
    private readonly inner: IFlowVersionRepository,
    private readonly cache: TtlCache<FlowVersion>,
  ) {}

  async getById(id: string): Promise<Result<FlowVersion | null>> {
    const cached = this.cache.get(id);
    if (cached) return { data: cached };

    const result = await this.inner.getById(id);
    if (isOk(result) && result.data && result.data.status === "published") {
      this.cache.set(id, result.data);
    }
    return result;
  }

  createPublished(input: CreatePublishedVersion): Promise<Result<FlowVersion>> {
    return this.inner.createPublished(input);
  }

  upsertDraft(input: UpsertDraftVersion): Promise<Result<FlowVersion>> {
    return this.inner.upsertDraft(input);
  }

  restore(input: RestoreVersion): Promise<Result<FlowVersion>> {
    return this.inner.restore(input);
  }

  listForFlow(flowId: string): Promise<Result<FlowVersionSummary[]>> {
    return this.inner.listForFlow(flowId);
  }

  getByNumber(flowId: string, versionNumber: number): Promise<Result<FlowVersion | null>> {
    return this.inner.getByNumber(flowId, versionNumber);
  }

  latestPublished(flowId: string): Promise<Result<FlowVersion | null>> {
    return this.inner.latestPublished(flowId);
  }

  openDraft(flowId: string): Promise<Result<FlowVersion | null>> {
    return this.inner.openDraft(flowId);
  }
}
