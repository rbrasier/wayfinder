import { describe, expect, it, vi } from "vitest";
import { findRecordCollections, ok } from "@rbrasier/domain";
import type {
  CachedValueSet,
  ILookupSourceRepository,
  LookupSource,
  LookupSourceKind,
  Result,
  ValueSetCandidate,
} from "@rbrasier/domain";
import { CachingValueSetProvider } from "./caching-value-set-provider";
import type { FetchRecordsInput, ValueSetKindAdapter } from "./value-set-kind-adapter";

const NOW = new Date("2026-08-02T12:00:00.000Z");

const source = (overrides: Partial<LookupSource> = {}): LookupSource => ({
  id: "source-1",
  name: "departments",
  label: "Departments",
  kind: "api",
  config: { url: "https://directory.example.gov/departments" },
  displayField: "department",
  keyField: "department_code",
  credentialSet: false,
  cacheTtlSeconds: 3600,
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const records = [
  { department: "Finance", department_code: "FIN-001" },
  { department: "Human Resources", department_code: "HR-002" },
];

class FakeRepository implements Partial<ILookupSourceRepository> {
  cached: CachedValueSet | null = null;
  readonly writes: CachedValueSet[] = [];

  constructor(private readonly row: LookupSource | null) {}

  async findByName(name: string): Promise<Result<LookupSource | null>> {
    return ok(this.row && this.row.name === name ? this.row : null);
  }

  async readCachedEntries(): Promise<Result<CachedValueSet | null>> {
    return ok(this.cached);
  }

  readonly credentialReads: string[] = [];

  async readCredential(id: string): Promise<Result<string | null>> {
    this.credentialReads.push(id);
    return ok("Bearer stored-secret");
  }

  async replaceCachedEntries(_sourceId: string, cached: CachedValueSet): Promise<Result<void>> {
    this.writes.push(cached);
    this.cached = cached;
    return ok(undefined);
  }
}

class FakeAdapter implements ValueSetKindAdapter {
  readonly calls: FetchRecordsInput[] = [];

  constructor(
    private readonly rows: Array<Record<string, string>>,
    private readonly failing = false,
    private readonly filters = true,
  ) {}

  filtersAtSource(): boolean {
    return this.filters;
  }

  async fetchRecords(input: FetchRecordsInput) {
    this.calls.push(input);
    if (this.failing) {
      return { error: { code: "INFRA_FAILURE" as const, message: "source unreachable" } };
    }
    return ok(this.rows);
  }

  async discoverCollections(input: FetchRecordsInput) {
    this.calls.push(input);
    if (this.failing) {
      return { error: { code: "INFRA_FAILURE" as const, message: "source unreachable" } };
    }
    return ok(findRecordCollections(this.rows));
  }
}

const build = (
  repository: FakeRepository,
  adapters: Partial<Record<LookupSourceKind, ValueSetKindAdapter>>,
  options: { now?: Date; version?: string } = {},
) =>
  new CachingValueSetProvider({
    sources: repository as unknown as ILookupSourceRepository,
    adapters,
    now: () => options.now ?? NOW,
    newVersion: () => options.version ?? "v-new",
  });

describe("CachingValueSetProvider.list", () => {
  it("fetches, maps and caches a set the first time it is asked for", async () => {
    const repository = new FakeRepository(source());
    const adapter = new FakeAdapter(records);

    const result = await build(repository, { api: adapter }).list("departments");

    expect(result.data?.entries).toEqual([
      { display: "Finance", key: "FIN-001" },
      { display: "Human Resources", key: "HR-002" },
    ]);
    expect(result.data?.stale).toBe(false);
    expect(repository.writes).toHaveLength(1);
  });

  it("serves a set inside its TTL without calling the source again", async () => {
    const repository = new FakeRepository(source());
    repository.cached = {
      entries: [{ display: "Finance", key: "FIN-001" }],
      version: "v-old",
      fetchedAt: new Date(NOW.getTime() - 60_000),
    };
    const adapter = new FakeAdapter(records);

    const result = await build(repository, { api: adapter }).list("departments");

    expect(adapter.calls).toHaveLength(0);
    expect(result.data?.version).toBe("v-old");
  });

  it("refreshes once the TTL has passed", async () => {
    const repository = new FakeRepository(source());
    repository.cached = {
      entries: [{ display: "Finance", key: "FIN-001" }],
      version: "v-old",
      fetchedAt: new Date(NOW.getTime() - 3_601_000),
    };
    const adapter = new FakeAdapter(records);

    const result = await build(repository, { api: adapter }).list("departments");

    expect(adapter.calls).toHaveLength(1);
    expect(result.data?.entries).toHaveLength(2);
  });

  it("keeps the existing version when a refresh returns the same content", async () => {
    const repository = new FakeRepository(source());
    repository.cached = {
      entries: [
        { display: "Finance", key: "FIN-001" },
        { display: "Human Resources", key: "HR-002" },
      ],
      version: "v-old",
      fetchedAt: new Date(NOW.getTime() - 3_601_000),
    };
    const adapter = new FakeAdapter(records);

    const result = await build(repository, { api: adapter }).list("departments");

    expect(result.data?.version).toBe("v-old");
    expect(repository.writes[0]?.version).toBe("v-old");
  });

  it("writes a new version when the content has changed", async () => {
    const repository = new FakeRepository(source());
    repository.cached = {
      entries: [{ display: "Finance", key: "FIN-999" }],
      version: "v-old",
      fetchedAt: new Date(NOW.getTime() - 3_601_000),
    };
    const adapter = new FakeAdapter(records);

    const result = await build(repository, { api: adapter }).list("departments");

    expect(result.data?.version).toBe("v-new");
  });

  it("serves the last-known-good set, flagged stale, when the source is unreachable", async () => {
    const repository = new FakeRepository(source());
    repository.cached = {
      entries: [{ display: "Finance", key: "FIN-001" }],
      version: "v-old",
      fetchedAt: new Date(NOW.getTime() - 3_601_000),
    };
    const adapter = new FakeAdapter([], true);

    const result = await build(repository, { api: adapter }).list("departments");

    expect(result.error).toBeUndefined();
    expect(result.data?.stale).toBe(true);
    expect(result.data?.version).toBe("v-old");
    expect(repository.writes).toHaveLength(0);
  });

  it("reports an error when the source is unreachable and nothing was ever cached", async () => {
    const repository = new FakeRepository(source());
    const adapter = new FakeAdapter([], true);

    const result = await build(repository, { api: adapter }).list("departments");

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("reads a managed source straight from its rows and never overwrites them", async () => {
    const repository = new FakeRepository(source({ kind: "managed" }));
    repository.cached = {
      entries: [{ display: "Alpha", key: "A" }],
      version: "v-managed",
      fetchedAt: new Date(NOW.getTime() - 999_999_000),
    };
    const adapter = new FakeAdapter(records);

    const result = await build(repository, { managed: adapter }).list("departments");

    expect(result.data?.entries).toEqual([{ display: "Alpha", key: "A" }]);
    expect(repository.writes).toHaveLength(0);
  });

  it("reports a source that is not registered", async () => {
    const repository = new FakeRepository(null);

    const result = await build(repository, {}).list("departments");

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("reports a source that has been disabled", async () => {
    const repository = new FakeRepository(source({ enabled: false }));

    const result = await build(repository, { api: new FakeAdapter(records) }).list("departments");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("CachingValueSetProvider.search", () => {
  it("asks the source for matches and maps them to entries", async () => {
    const repository = new FakeRepository(source());
    const adapter = new FakeAdapter(records);

    const result = await build(repository, { api: adapter }).search({
      sourceName: "departments",
      query: "fin",
      limit: 10,
    });

    expect(adapter.calls[0]?.query).toBe("fin");
    expect(result.data?.[0]).toEqual({ display: "Finance", key: "FIN-001" });
  });

  it("falls back to filtering the cached set when the source is unreachable", async () => {
    const repository = new FakeRepository(source());
    repository.cached = {
      entries: [
        { display: "Finance", key: "FIN-001" },
        { display: "Legal", key: "LEG-003" },
      ],
      version: "v-old",
      fetchedAt: new Date(NOW.getTime() - 60_000),
    };
    const adapter = new FakeAdapter([], true);

    const result = await build(repository, { api: adapter }).search({
      sourceName: "departments",
      query: "fin",
      limit: 10,
    });

    expect(result.data).toEqual([{ display: "Finance", key: "FIN-001" }]);
  });
});

describe("CachingValueSetProvider.resolve", () => {
  const withSet = () => {
    const repository = new FakeRepository(source());
    repository.cached = {
      entries: [
        { display: "Finance", key: "FIN-001" },
        { display: "Operations", key: "OPS-003" },
        { display: "Operations", key: "OPS-009" },
      ],
      version: "v-old",
      fetchedAt: new Date(NOW.getTime() - 60_000),
    };
    return repository;
  };

  it("canonicalises casing and pairs each input with its entry", async () => {
    const provider = build(withSet(), { api: new FakeAdapter(records) });

    const result = await provider.resolve("departments", ["finance"]);

    expect(result.data?.matched).toEqual([
      { input: "finance", entry: { display: "Finance", key: "FIN-001" } },
    ]);
    expect(result.data?.unresolved).toEqual([]);
  });

  it("reports a value the set does not contain", async () => {
    const provider = build(withSet(), { api: new FakeAdapter(records) });

    const result = await provider.resolve("departments", ["Marketing"]);

    expect(result.data?.unresolved).toEqual(["Marketing"]);
  });

  it("reports a value matching two entries with distinct keys as ambiguous", async () => {
    const provider = build(withSet(), { api: new FakeAdapter(records) });

    const result = await provider.resolve("departments", ["Operations"]);

    expect(result.data?.ambiguous).toEqual(["Operations"]);
    expect(result.data?.matched).toEqual([]);
  });

  it("carries the version and fetch time that a stored value snapshots", async () => {
    const provider = build(withSet(), { api: new FakeAdapter(records) });

    const result = await provider.resolve("departments", ["Finance"]);

    expect(result.data?.version).toBe("v-old");
    expect(result.data?.stale).toBe(false);
  });

  it("marks the outcome stale when the set could not be refreshed", async () => {
    const repository = withSet();
    repository.cached = { ...repository.cached!, fetchedAt: new Date(NOW.getTime() - 3_601_000) };
    const provider = build(repository, { api: new FakeAdapter([], true) });

    const result = await provider.resolve("departments", ["Marketing"]);

    expect(result.data?.stale).toBe(true);
  });
});

describe("CachingValueSetProvider.probe", () => {
  it("returns the lists found in the response", async () => {
    const repository = new FakeRepository(null);
    const adapter = new FakeAdapter(records);

    const result = await build(repository, { api: adapter }).probe({
      kind: "api",
      config: { url: "https://directory.example.gov/departments" },
    });

    expect(result.data?.collections).toHaveLength(1);
    expect(result.data?.collections[0]?.fields).toEqual(["department", "department_code"]);
    expect(result.data?.collections[0]?.count).toBe(2);
  });

  it("passes the caller's credential through to the adapter", async () => {
    const repository = new FakeRepository(null);
    const adapter = new FakeAdapter(records);

    await build(repository, { api: adapter }).probe({
      kind: "api",
      config: {},
      credential: "Bearer typed-by-admin",
    });

    expect(adapter.calls[0]?.credential).toBe("Bearer typed-by-admin");
  });

  it("surfaces a probe failure so Test reports it to the admin", async () => {
    const repository = new FakeRepository(null);

    const result = await build(repository, { api: new FakeAdapter([], true) }).probe({
      kind: "api",
      config: {},
    });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("reports a kind with no adapter wired", async () => {
    const repository = new FakeRepository(null);

    const result = await build(repository, {}).probe({ kind: "directory", config: {} });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("CachingValueSetProvider — credentials", () => {
  it("decrypts the stored credential only for a source that has one", async () => {
    const repository = new FakeRepository(source({ credentialSet: true }));
    const adapter = new FakeAdapter(records);

    await build(repository, { api: adapter }).list("departments");

    expect(repository.credentialReads).toEqual(["source-1"]);
    expect(adapter.calls[0]?.credential).toBe("Bearer stored-secret");
  });

  it("never reads a credential for a source without one", async () => {
    const repository = new FakeRepository(source({ credentialSet: false }));
    const adapter = new FakeAdapter(records);

    await build(repository, { api: adapter }).list("departments");

    expect(repository.credentialReads).toEqual([]);
    expect(adapter.calls[0]?.credential).toBeUndefined();
  });
});

describe("CachingValueSetProvider.search — narrowing", () => {
  const wideRecords = [
    { department: "Finance", department_code: "FIN-001" },
    { department: "Finance & Procurement", department_code: "FIN-002" },
    { department: "Corporate Services", department_code: "CS-001" },
  ];

  it("filters in memory when the adapter cannot filter for this source", async () => {
    const repository = new FakeRepository(source());
    const adapter = new FakeAdapter(wideRecords, false, false);

    const result = await build(repository, { api: adapter }).search({
      sourceName: "departments",
      query: "corporate",
      limit: 20,
    });

    expect(result.data?.map((entry) => entry.display)).toEqual(["Corporate Services"]);
  });

  it("trusts an adapter that says it filtered, rather than filtering twice", async () => {
    const repository = new FakeRepository(source());
    const adapter = new FakeAdapter(wideRecords, false, true);

    const result = await build(repository, { api: adapter }).search({
      sourceName: "departments",
      query: "corporate",
      limit: 20,
    });

    expect(result.data).toHaveLength(3);
  });

  it("falls back to the ranked ladder when substring finds nothing", async () => {
    const repository = new FakeRepository(source());
    const adapter = new FakeAdapter(wideRecords, false, false);

    const result = await build(repository, { api: adapter }).search({
      sourceName: "departments",
      query: "Corprate Servces",
      limit: 20,
    });

    expect(result.data?.[0]?.display).toBe("Corporate Services");
  });

  it("returns the head of the set for an empty query", async () => {
    const repository = new FakeRepository(source());
    const adapter = new FakeAdapter(wideRecords, false, false);

    const result = await build(repository, { api: adapter }).search({
      sourceName: "departments",
      query: "",
      limit: 2,
    });

    expect(result.data).toHaveLength(2);
  });
});

describe("CachingValueSetProvider.match", () => {
  const wideRecords = [
    { department: "Finance", department_code: "FIN-001" },
    { department: "Corporate Services", department_code: "CS-001" },
  ];

  const shortlister = (candidates: ValueSetCandidate[]) => ({
    shortlist: vi.fn().mockResolvedValue(ok(candidates)),
  });

  const buildMatcher = (
    repository: FakeRepository,
    adapter: ValueSetKindAdapter,
    index?: { shortlist: ReturnType<typeof vi.fn> },
  ) =>
    new CachingValueSetProvider({
      sources: repository as unknown as ILookupSourceRepository,
      adapters: { api: adapter },
      now: () => NOW,
      newVersion: () => "v-new",
      ...(index ? { shortlister: index } : {}),
    });

  it("resolves a spelling variant without consulting the model", async () => {
    const index = shortlister([]);
    const provider = buildMatcher(new FakeRepository(source()), new FakeAdapter(wideRecords), index);

    const result = await provider.match({ sourceName: "departments", values: ["  finance  "] });

    expect(result.data?.matches[0]?.outcome).toEqual({
      kind: "resolved",
      candidate: { entry: { display: "Finance", key: "FIN-001" }, score: 1, tier: "exact" },
    });
    expect(index.shortlist).not.toHaveBeenCalled();
  });

  it("shortlists rather than deciding when the best it has is a related word", async () => {
    const provider = buildMatcher(new FakeRepository(source()), new FakeAdapter(wideRecords));

    const result = await provider.match({ sourceName: "departments", values: ["corporate"] });
    const outcome = result.data?.matches[0]?.outcome;

    expect(outcome?.kind).toBe("candidates");
    expect(outcome?.kind === "candidates" && outcome.candidates[0]?.entry.display).toBe(
      "Corporate Services",
    );
  });

  it("reaches an entry that shares no letters with the input, via the model", async () => {
    const index = shortlister([
      { entry: { display: "Finance", key: "FIN-001" }, score: 0.9, tier: "inferred" },
    ]);
    const provider = buildMatcher(new FakeRepository(source()), new FakeAdapter(wideRecords), index);

    const result = await provider.match({ sourceName: "departments", values: ["procurement"] });
    const outcome = result.data?.matches[0]?.outcome;

    expect(outcome?.kind).toBe("candidates");
    expect(outcome?.kind === "candidates" && outcome.candidates[0]?.entry.key).toBe("FIN-001");
    expect(index.shortlist).toHaveBeenCalledWith(
      expect.objectContaining({ query: "procurement", limit: 5 }),
    );
  });

  it("reports nothing found rather than guessing when every rung comes up empty", async () => {
    const provider = buildMatcher(new FakeRepository(source()), new FakeAdapter(wideRecords));

    const result = await provider.match({ sourceName: "departments", values: ["aardvark"] });

    expect(result.data?.matches[0]?.outcome.kind).toBe("none");
  });

  it("carries the version and staleness of the set the suggestions came from", async () => {
    const repository = new FakeRepository(source());
    repository.cached = {
      entries: [{ display: "Finance", key: "FIN-001" }],
      version: "v-old",
      fetchedAt: new Date("2020-01-01T00:00:00.000Z"),
    };
    const provider = buildMatcher(repository, new FakeAdapter([], true));

    const result = await provider.match({ sourceName: "departments", values: ["finance"] });

    expect(result.data?.stale).toBe(true);
    expect(result.data?.version).toBe("v-old");
  });

  it("runs the whole batch in one pass over the set", async () => {
    const provider = buildMatcher(new FakeRepository(source()), new FakeAdapter(wideRecords));

    const result = await provider.match({
      sourceName: "departments",
      values: ["finance", "corporate services"],
    });

    expect(result.data?.matches.map((match) => match.outcome.kind)).toEqual([
      "resolved",
      "resolved",
    ]);
  });

  it("reports an unregistered source rather than an empty shortlist", async () => {
    const provider = buildMatcher(new FakeRepository(null), new FakeAdapter(wideRecords));

    const result = await provider.match({ sourceName: "departments", values: ["finance"] });

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("hands the model the cached set, so it chooses from the source and not from memory", async () => {
    const index = shortlister([]);
    const provider = buildMatcher(new FakeRepository(source()), new FakeAdapter(wideRecords), index);

    await provider.match({ sourceName: "departments", values: ["procurement"] });

    expect(index.shortlist.mock.calls[0]?.[0]?.entries).toEqual([
      { display: "Finance", key: "FIN-001" },
      { display: "Corporate Services", key: "CS-001" },
    ]);
  });

  it("passes the field label through as context when the caller supplies one", async () => {
    const index = shortlister([]);
    const provider = buildMatcher(new FakeRepository(source()), new FakeAdapter(wideRecords), index);

    await provider.match({
      sourceName: "departments",
      values: ["procurement"],
      context: "Department",
    });

    expect(index.shortlist.mock.calls[0]?.[0]?.fieldLabel).toBe("Department");
  });

  it("corrects a near-certain misspelling without consulting the model", async () => {
    const index = shortlister([]);
    const provider = buildMatcher(new FakeRepository(source()), new FakeAdapter(wideRecords), index);

    const result = await provider.match({
      sourceName: "departments",
      values: ["Corprate Services"],
    });
    const outcome = result.data?.matches[0]?.outcome;

    expect(outcome?.kind).toBe("resolved");
    expect(outcome?.kind === "resolved" && outcome.candidate.entry.key).toBe("CS-001");
    expect(index.shortlist).not.toHaveBeenCalled();
  });

  it("passes the source's own entry budget to the model", async () => {
    const index = shortlister([]);
    const configured = source();
    configured.config = { ...configured.config, shortlistBudget: 250 };
    const provider = buildMatcher(new FakeRepository(configured), new FakeAdapter(wideRecords), index);

    await provider.match({ sourceName: "departments", values: ["procurement"] });

    expect(index.shortlist.mock.calls[0]?.[0]?.budget).toBe(250);
  });

  it("ignores a budget that is not a usable number", async () => {
    const index = shortlister([]);
    const configured = source();
    configured.config = { ...configured.config, shortlistBudget: 0 };
    const provider = buildMatcher(new FakeRepository(configured), new FakeAdapter(wideRecords), index);

    await provider.match({ sourceName: "departments", values: ["procurement"] });

    expect(index.shortlist.mock.calls[0]?.[0]?.budget).toBeUndefined();
  });

  it("still narrows when no model is configured at all", async () => {
    const provider = buildMatcher(new FakeRepository(source()), new FakeAdapter(wideRecords));

    const result = await provider.match({ sourceName: "departments", values: ["corporate"] });

    expect(result.data?.matches[0]?.outcome.kind).toBe("candidates");
  });
});
