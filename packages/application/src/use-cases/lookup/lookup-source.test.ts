import { describe, it, expect } from "vitest";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  PROBE_SAMPLE_LIMIT,
  ok,
  type CachedValueSet,
  type ILookupSourceRepository,
  type IValueSetProvider,
  type LookupSource,
  type NewLookupSource,
  type Result,
  type ValueSetEntry,
  type ValueSetProbe,
} from "@rbrasier/domain";
import {
  DeleteLookupSource,
  ListLookupSources,
  RegisterLookupSource,
  TestLookupSource,
  UpdateLookupSource,
} from "./lookup-source";

const draft: NewLookupSource = {
  name: "departments",
  label: "Departments",
  kind: "directory",
  config: {},
  displayField: "department",
  keyField: "department_code",
  cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
  enabled: true,
};

class FakeLookupSourceRepository implements ILookupSourceRepository {
  readonly rows: LookupSource[] = [];
  private nextId = 1;

  async list(): Promise<Result<LookupSource[]>> {
    return ok([...this.rows]);
  }

  async findById(id: string): Promise<Result<LookupSource | null>> {
    return ok(this.rows.find((row) => row.id === id) ?? null);
  }

  async findByName(name: string): Promise<Result<LookupSource | null>> {
    return ok(this.rows.find((row) => row.name === name) ?? null);
  }

  async create(source: NewLookupSource): Promise<Result<LookupSource>> {
    const row: LookupSource = {
      ...source,
      id: `source-${this.nextId++}`,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    };
    this.rows.push(row);
    return ok(row);
  }

  async update(id: string, source: NewLookupSource): Promise<Result<LookupSource>> {
    const index = this.rows.findIndex((row) => row.id === id);
    const existing = this.rows[index]!;
    const updated: LookupSource = { ...existing, ...source, updatedAt: new Date() };
    this.rows[index] = updated;
    return ok(updated);
  }

  async deleteById(id: string): Promise<Result<void>> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) this.rows.splice(index, 1);
    return ok(undefined);
  }

  async readCachedEntries(): Promise<Result<CachedValueSet | null>> {
    return ok(null);
  }

  async replaceCachedEntries(): Promise<Result<void>> {
    return ok(undefined);
  }
}

class FakeValueSetProvider implements IValueSetProvider {
  probeCalls = 0;

  constructor(
    private readonly sample: Array<Record<string, string>>,
    private readonly failing = false,
  ) {}

  async probe(): Promise<Result<ValueSetProbe>> {
    this.probeCalls += 1;
    if (this.failing) {
      return { error: { code: "INFRA_FAILURE" as const, message: "source unreachable" } };
    }
    const fields = [...new Set(this.sample.flatMap((record) => Object.keys(record)))];
    return ok({ fields, sample: this.sample.slice(0, PROBE_SAMPLE_LIMIT) });
  }

  async search(): Promise<Result<ValueSetEntry[]>> {
    return ok([]);
  }

  async list() {
    return ok({ entries: [], version: "v1", fetchedAt: new Date(0), stale: false });
  }

  async resolve() {
    return ok({
      matched: [],
      unresolved: [],
      ambiguous: [],
      stale: false,
      version: "v1",
      fetchedAt: new Date(0),
    });
  }
}

const sampleRecords = [
  { department: "Finance", department_code: "FIN-001" },
  { department: "Human Resources", department_code: "HR-002" },
];

describe("RegisterLookupSource", () => {
  it("creates a source with its display and key fields", async () => {
    const repository = new FakeLookupSourceRepository();

    const result = await new RegisterLookupSource(repository).execute(draft);

    expect(result.error).toBeUndefined();
    expect(result.data?.name).toBe("departments");
    expect(result.data?.keyField).toBe("department_code");
  });

  it("creates a source with no key field", async () => {
    const repository = new FakeLookupSourceRepository();

    const result = await new RegisterLookupSource(repository).execute({
      ...draft,
      keyField: undefined,
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.keyField).toBeUndefined();
  });

  it("rejects a second source with the same name", async () => {
    const repository = new FakeLookupSourceRepository();
    const register = new RegisterLookupSource(repository);
    await register.execute(draft);

    const result = await register.execute({ ...draft, label: "Departments again" });

    expect(result.error?.code).toBe("ALREADY_EXISTS");
  });

  it("refuses to save without a display field", async () => {
    const repository = new FakeLookupSourceRepository();

    const result = await new RegisterLookupSource(repository).execute({
      ...draft,
      displayField: "",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(repository.rows).toHaveLength(0);
  });

  it("refuses a name that is not a slug", async () => {
    const repository = new FakeLookupSourceRepository();

    const result = await new RegisterLookupSource(repository).execute({
      ...draft,
      name: "My Departments",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("UpdateLookupSource", () => {
  it("changes the display and key selections", async () => {
    const repository = new FakeLookupSourceRepository();
    const created = await new RegisterLookupSource(repository).execute(draft);

    const result = await new UpdateLookupSource(repository).execute(created.data!.id, {
      ...draft,
      displayField: "name",
      keyField: "code",
    });

    expect(result.data?.displayField).toBe("name");
    expect(result.data?.keyField).toBe("code");
  });

  it("reports a source that does not exist", async () => {
    const repository = new FakeLookupSourceRepository();

    const result = await new UpdateLookupSource(repository).execute("missing", draft);

    expect(result.error?.code).toBe("NOT_FOUND");
  });

  it("rejects renaming onto another source's name", async () => {
    const repository = new FakeLookupSourceRepository();
    const register = new RegisterLookupSource(repository);
    await register.execute(draft);
    const second = await register.execute({ ...draft, name: "cost-centres" });

    const result = await new UpdateLookupSource(repository).execute(second.data!.id, {
      ...draft,
      name: "departments",
    });

    expect(result.error?.code).toBe("ALREADY_EXISTS");
  });

  it("allows a source to keep its own name", async () => {
    const repository = new FakeLookupSourceRepository();
    const created = await new RegisterLookupSource(repository).execute(draft);

    const result = await new UpdateLookupSource(repository).execute(created.data!.id, {
      ...draft,
      label: "Org departments",
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.label).toBe("Org departments");
  });
});

describe("TestLookupSource", () => {
  it("returns the field names an admin can choose from, with a bounded sample", async () => {
    const provider = new FakeValueSetProvider(sampleRecords);

    const result = await new TestLookupSource(provider).execute({
      kind: "directory",
      config: {},
    });

    expect(result.data?.fields).toEqual(["department", "department_code"]);
    expect(result.data?.sample).toHaveLength(2);
  });

  it("previews resolved pairs once the admin has chosen the fields", async () => {
    const provider = new FakeValueSetProvider(sampleRecords);

    const result = await new TestLookupSource(provider).execute({
      kind: "directory",
      config: {},
      displayField: "department",
      keyField: "department_code",
    });

    expect(result.data?.preview).toEqual([
      { display: "Finance", key: "FIN-001" },
      { display: "Human Resources", key: "HR-002" },
    ]);
  });

  it("previews the display alone when no key field is chosen", async () => {
    const provider = new FakeValueSetProvider(sampleRecords);

    const result = await new TestLookupSource(provider).execute({
      kind: "directory",
      config: {},
      displayField: "department",
    });

    expect(result.data?.preview).toEqual([{ display: "Finance" }, { display: "Human Resources" }]);
  });

  it("reports a display field the source does not have", async () => {
    const provider = new FakeValueSetProvider(sampleRecords);

    const result = await new TestLookupSource(provider).execute({
      kind: "directory",
      config: {},
      displayField: "missing_field",
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("missing_field");
  });

  it("surfaces a provider failure as an error rather than an empty result", async () => {
    const provider = new FakeValueSetProvider(sampleRecords, true);

    const result = await new TestLookupSource(provider).execute({ kind: "api", config: {} });

    expect(result.error?.code).toBe("INFRA_FAILURE");
  });

  it("reports a source that returns no records", async () => {
    const provider = new FakeValueSetProvider([]);

    const result = await new TestLookupSource(provider).execute({ kind: "api", config: {} });

    expect(result.data?.fields).toEqual([]);
    expect(result.data?.sample).toEqual([]);
    expect(result.data?.preview).toEqual([]);
  });
});

describe("ListLookupSources and DeleteLookupSource", () => {
  it("lists every registered source", async () => {
    const repository = new FakeLookupSourceRepository();
    const register = new RegisterLookupSource(repository);
    await register.execute(draft);
    await register.execute({ ...draft, name: "cost-centres" });

    const result = await new ListLookupSources(repository).execute();

    expect(result.data?.map((source) => source.name)).toEqual(["departments", "cost-centres"]);
  });

  it("deletes a source", async () => {
    const repository = new FakeLookupSourceRepository();
    const created = await new RegisterLookupSource(repository).execute(draft);

    const result = await new DeleteLookupSource(repository).execute(created.data!.id);

    expect(result.error).toBeUndefined();
    expect(repository.rows).toHaveLength(0);
  });

  it("reports deleting a source that does not exist", async () => {
    const repository = new FakeLookupSourceRepository();

    const result = await new DeleteLookupSource(repository).execute("missing");

    expect(result.error?.code).toBe("NOT_FOUND");
  });
});
