import { describe, expect, it, vi } from "vitest";
import { ok, type FlowVersion, type IFlowVersionRepository } from "@rbrasier/domain";
import { TtlCache } from "../cache/ttl-cache";
import { CachedFlowVersionRepository } from "./cached-flow-version-repository";

const makeVersion = (overrides: Partial<FlowVersion> = {}): FlowVersion =>
  ({
    id: "version-1",
    flowId: "flow-1",
    versionNumber: 1,
    status: "published",
    snapshot: { flow: {}, nodes: [], edges: [] },
    changeSummary: null,
    publishedByUserId: "user-1",
    createdAt: new Date(),
    ...overrides,
  }) as FlowVersion;

const makeInner = (version: FlowVersion | null): IFlowVersionRepository =>
  ({
    getById: vi.fn(async () => ok(version)),
    createPublished: vi.fn(),
    upsertDraft: vi.fn(),
    restore: vi.fn(),
    listForFlow: vi.fn(),
    getByNumber: vi.fn(),
    latestPublished: vi.fn(),
    openDraft: vi.fn(),
  }) as unknown as IFlowVersionRepository;

const cache = () => new TtlCache<FlowVersion>({ ttlMs: 60_000, maxEntries: 16 });

describe("CachedFlowVersionRepository.getById", () => {
  it("reads a published version once, then serves it from cache", async () => {
    const inner = makeInner(makeVersion());
    const repo = new CachedFlowVersionRepository(inner, cache());

    const first = await repo.getById("version-1");
    const second = await repo.getById("version-1");

    expect(first).toEqual(second);
    expect(inner.getById).toHaveBeenCalledTimes(1);
  });

  it("never caches a draft version — its snapshot is still mutable", async () => {
    const inner = makeInner(makeVersion({ status: "draft", versionNumber: null }));
    const repo = new CachedFlowVersionRepository(inner, cache());

    await repo.getById("version-1");
    await repo.getById("version-1");

    expect(inner.getById).toHaveBeenCalledTimes(2);
  });

  it("does not cache a miss", async () => {
    const inner = makeInner(null);
    const repo = new CachedFlowVersionRepository(inner, cache());

    await repo.getById("missing");
    await repo.getById("missing");

    expect(inner.getById).toHaveBeenCalledTimes(2);
  });
});
