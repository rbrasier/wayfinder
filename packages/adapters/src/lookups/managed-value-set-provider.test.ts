import { describe, expect, it } from "vitest";
import { ok } from "@rbrasier/domain";
import type { CachedValueSet, ILookupSourceRepository, Result } from "@rbrasier/domain";
import {
  MANAGED_DISPLAY_FIELD,
  MANAGED_KEY_FIELD,
  ManagedValueSetAdapter,
} from "./managed-value-set-provider";

const repositoryHolding = (cached: CachedValueSet | null): ILookupSourceRepository =>
  ({
    readCachedEntries: async (): Promise<Result<CachedValueSet | null>> => ok(cached),
  }) as unknown as ILookupSourceRepository;

const cached: CachedValueSet = {
  entries: [
    { display: "Finance", key: "FIN-001" },
    { display: "Human Resources", key: "HR-002" },
  ],
  version: "v1",
  fetchedAt: new Date("2026-08-02T09:00:00.000Z"),
};

describe("ManagedValueSetAdapter", () => {
  it("returns the admin-entered rows under the fixed managed field names", async () => {
    const adapter = new ManagedValueSetAdapter(repositoryHolding(cached));

    const result = await adapter.fetchRecords({ config: {}, sourceId: "source-1" });

    expect(result.data).toEqual([
      { [MANAGED_DISPLAY_FIELD]: "Finance", [MANAGED_KEY_FIELD]: "FIN-001" },
      { [MANAGED_DISPLAY_FIELD]: "Human Resources", [MANAGED_KEY_FIELD]: "HR-002" },
    ]);
  });

  it("omits the key field for an entry that has no key", async () => {
    const adapter = new ManagedValueSetAdapter(
      repositoryHolding({ ...cached, entries: [{ display: "Alpha" }] }),
    );

    const result = await adapter.fetchRecords({ config: {}, sourceId: "source-1" });

    expect(result.data?.[0]).toEqual({ [MANAGED_DISPLAY_FIELD]: "Alpha" });
  });

  it("returns nothing for a draft that has not been saved yet", async () => {
    const adapter = new ManagedValueSetAdapter(repositoryHolding(cached));

    const result = await adapter.fetchRecords({ config: {} });

    expect(result.data).toEqual([]);
  });

  it("returns nothing when the admin has entered no rows", async () => {
    const adapter = new ManagedValueSetAdapter(repositoryHolding(null));

    const result = await adapter.fetchRecords({ config: {}, sourceId: "source-1" });

    expect(result.data).toEqual([]);
  });

  it("filters on the type-ahead term, since there is no source to ask", async () => {
    const adapter = new ManagedValueSetAdapter(repositoryHolding(cached));

    const result = await adapter.fetchRecords({
      config: {},
      sourceId: "source-1",
      query: "hum",
    });

    expect(result.data).toEqual([
      { [MANAGED_DISPLAY_FIELD]: "Human Resources", [MANAGED_KEY_FIELD]: "HR-002" },
    ]);
  });

  it("matches the type-ahead term against the key as well as the display", async () => {
    const adapter = new ManagedValueSetAdapter(repositoryHolding(cached));

    const result = await adapter.fetchRecords({
      config: {},
      sourceId: "source-1",
      query: "fin-0",
    });

    expect(result.data).toHaveLength(1);
  });

  it("applies the caller's limit", async () => {
    const adapter = new ManagedValueSetAdapter(repositoryHolding(cached));

    const result = await adapter.fetchRecords({ config: {}, sourceId: "source-1", limit: 1 });

    expect(result.data).toHaveLength(1);
  });

  it("surfaces a repository failure", async () => {
    const repository = {
      readCachedEntries: async () => ({
        error: { code: "INFRA_FAILURE" as const, message: "database down" },
      }),
    } as unknown as ILookupSourceRepository;

    const result = await new ManagedValueSetAdapter(repository).fetchRecords({
      config: {},
      sourceId: "source-1",
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});
