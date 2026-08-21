import { describe, it, expect } from "vitest";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  ok,
  type CachedValueSet,
  type ILookupSourceRepository,
  type LookupSource,
  type NewLookupSource,
  type Result,
  type ValueSetEntry,
} from "@rbrasier/domain";
import { ListManagedEntries, ReplaceManagedEntries } from "./managed-entries";

const managedSource = (overrides: Partial<LookupSource> = {}): LookupSource => ({
  id: "source-1",
  name: "cost-centres",
  label: "Cost Centres",
  kind: "managed",
  config: {},
  displayField: "display",
  keyField: "key",
  credentialSet: false,
  cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
  enabled: true,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  ...overrides,
});

class FakeRepository implements Partial<ILookupSourceRepository> {
  cached: CachedValueSet | null = null;
  readonly writes: CachedValueSet[] = [];

  constructor(private readonly row: LookupSource | null) {}

  async findById(id: string): Promise<Result<LookupSource | null>> {
    return ok(this.row && this.row.id === id ? this.row : null);
  }

  async readCachedEntries(): Promise<Result<CachedValueSet | null>> {
    return ok(this.cached);
  }

  async replaceCachedEntries(_sourceId: string, cached: CachedValueSet): Promise<Result<void>> {
    this.writes.push(cached);
    this.cached = cached;
    return ok(undefined);
  }
}

const build = (repository: FakeRepository, version = "v-new") =>
  new ReplaceManagedEntries(repository as unknown as ILookupSourceRepository, {
    now: () => new Date("2026-08-05T09:00:00.000Z"),
    newVersion: () => version,
  });

const entries: ValueSetEntry[] = [
  { display: "Corporate Services", key: "CC-100" },
  { display: "Field Operations", key: "CC-200" },
];

describe("ListManagedEntries", () => {
  it("returns the rows an admin has entered", async () => {
    const repository = new FakeRepository(managedSource());
    repository.cached = { entries, version: "v1", fetchedAt: new Date(0) };

    const result = await new ListManagedEntries(
      repository as unknown as ILookupSourceRepository,
    ).execute("source-1");

    expect(result.data).toEqual(entries);
  });

  it("returns an empty list for a source with no rows yet", async () => {
    const repository = new FakeRepository(managedSource());

    const result = await new ListManagedEntries(
      repository as unknown as ILookupSourceRepository,
    ).execute("source-1");

    expect(result.data).toEqual([]);
  });

  it("refuses a source that is not managed, whose values come from elsewhere", async () => {
    const repository = new FakeRepository(managedSource({ kind: "api" }));

    const result = await new ListManagedEntries(
      repository as unknown as ILookupSourceRepository,
    ).execute("source-1");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("reports a source that does not exist", async () => {
    const repository = new FakeRepository(null);

    const result = await new ListManagedEntries(
      repository as unknown as ILookupSourceRepository,
    ).execute("missing");

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("ReplaceManagedEntries", () => {
  it("saves the rows and stamps them with a version", async () => {
    const repository = new FakeRepository(managedSource());

    const result = await build(repository).execute("source-1", entries);

    expect(result.error).toBeUndefined();
    expect(repository.writes[0]?.entries).toEqual(entries);
    expect(repository.writes[0]?.version).toBe("v-new");
  });

  it("trims what the admin typed", async () => {
    const repository = new FakeRepository(managedSource());

    await build(repository).execute("source-1", [{ display: "  Corporate  ", key: " CC-100 " }]);

    expect(repository.writes[0]?.entries).toEqual([{ display: "Corporate", key: "CC-100" }]);
  });

  it("drops a row with no display value, which could never be chosen", async () => {
    const repository = new FakeRepository(managedSource());

    await build(repository).execute("source-1", [
      { display: "Corporate", key: "CC-100" },
      { display: "   ", key: "CC-999" },
    ]);

    expect(repository.writes[0]?.entries).toHaveLength(1);
  });

  it("omits an empty key rather than storing a blank one", async () => {
    const repository = new FakeRepository(managedSource());

    await build(repository).execute("source-1", [{ display: "Corporate", key: "  " }]);

    expect(repository.writes[0]?.entries[0]).toEqual({ display: "Corporate" });
  });

  it("rejects two rows sharing a display and a key, which are the same value twice", async () => {
    const repository = new FakeRepository(managedSource());

    const result = await build(repository).execute("source-1", [
      { display: "Corporate", key: "CC-100" },
      { display: "corporate", key: "CC-100" },
    ]);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("Corporate");
    expect(repository.writes).toHaveLength(0);
  });

  it("allows two rows sharing a display when their keys differ", async () => {
    const repository = new FakeRepository(managedSource());

    const result = await build(repository).execute("source-1", [
      { display: "Operations", key: "OPS-1" },
      { display: "Operations", key: "OPS-2" },
    ]);

    expect(result.error).toBeUndefined();
  });

  it("keeps the existing version when the rows have not changed", async () => {
    const repository = new FakeRepository(managedSource());
    repository.cached = { entries, version: "v-old", fetchedAt: new Date(0) };

    await build(repository).execute("source-1", [...entries]);

    expect(repository.writes[0]?.version).toBe("v-old");
  });

  it("accepts an empty list, which clears the source", async () => {
    const repository = new FakeRepository(managedSource());
    repository.cached = { entries, version: "v-old", fetchedAt: new Date(0) };

    const result = await build(repository).execute("source-1", []);

    expect(result.error).toBeUndefined();
    expect(repository.writes[0]?.entries).toEqual([]);
  });

  it("refuses a source that is not managed", async () => {
    const repository = new FakeRepository(managedSource({ kind: "directory" }));

    const result = await build(repository).execute("source-1", entries);

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(repository.writes).toHaveLength(0);
  });
});
