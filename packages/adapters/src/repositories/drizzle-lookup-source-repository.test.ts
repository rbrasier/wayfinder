import { describe, expect, it } from "vitest";
import type { NewLookupSource } from "@rbrasier/domain";
import {
  toCachedValueSet,
  toEntryRows,
  toLookupSource,
  toLookupSourceColumns,
} from "./drizzle-lookup-source-repository";
import type { kb_lookup_source_entries, kb_lookup_sources } from "../db/schema/kb";

const CREATED_AT = new Date("2026-08-01T10:00:00.000Z");
const FETCHED_AT = new Date("2026-08-02T09:00:00.000Z");

const sourceRow = (
  overrides: Partial<typeof kb_lookup_sources.$inferSelect> = {},
): typeof kb_lookup_sources.$inferSelect => ({
  id: "source-1",
  name: "departments",
  label: "Departments",
  kind: "directory",
  config: {},
  display_field: "department",
  key_field: "department_code",
  credential_ref: null,
  cache_ttl_seconds: 3600,
  enabled: true,
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
  ...overrides,
});

const entryRow = (
  overrides: Partial<typeof kb_lookup_source_entries.$inferSelect> = {},
): typeof kb_lookup_source_entries.$inferSelect => ({
  id: "entry-1",
  source_id: "source-1",
  display: "Finance",
  key: "FIN-001",
  version: "v-2026-08-02",
  fetched_at: FETCHED_AT,
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
  ...overrides,
});

const draft: NewLookupSource = {
  name: "departments",
  label: "Departments",
  kind: "api",
  config: { url: "https://directory.example.gov/departments" },
  displayField: "department",
  keyField: "department_code",
  credentialRef: "lookup_departments_token",
  cacheTtlSeconds: 3600,
  enabled: true,
};

describe("toLookupSource", () => {
  it("maps a row onto the domain entity", () => {
    const source = toLookupSource(sourceRow());

    expect(source).toEqual({
      id: "source-1",
      name: "departments",
      label: "Departments",
      kind: "directory",
      config: {},
      displayField: "department",
      keyField: "department_code",
      cacheTtlSeconds: 3600,
      enabled: true,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
  });

  it("omits an absent key field rather than carrying a null", () => {
    const source = toLookupSource(sourceRow({ key_field: null }));

    expect("keyField" in source).toBe(false);
  });

  it("omits an absent credential reference", () => {
    const source = toLookupSource(sourceRow({ credential_ref: null }));

    expect("credentialRef" in source).toBe(false);
  });

  it("carries a credential reference when the source has one", () => {
    const source = toLookupSource(sourceRow({ credential_ref: "lookup_departments_token" }));

    expect(source.credentialRef).toBe("lookup_departments_token");
  });
});

describe("toLookupSourceColumns", () => {
  it("writes snake_case columns and nulls the optional fields", () => {
    const columns = toLookupSourceColumns({ ...draft, keyField: undefined, credentialRef: undefined });

    expect(columns.display_field).toBe("department");
    expect(columns.key_field).toBeNull();
    expect(columns.credential_ref).toBeNull();
  });

  it("keeps the credential reference, which points at the secret store", () => {
    expect(toLookupSourceColumns(draft).credential_ref).toBe("lookup_departments_token");
  });
});

describe("toEntryRows", () => {
  it("stamps every row with the same version and fetch time", () => {
    const rows = toEntryRows("source-1", {
      entries: [{ display: "Finance", key: "FIN-001" }, { display: "HR" }],
      version: "v-2026-08-02",
      fetchedAt: FETCHED_AT,
    });

    expect(rows).toEqual([
      {
        source_id: "source-1",
        display: "Finance",
        key: "FIN-001",
        version: "v-2026-08-02",
        fetched_at: FETCHED_AT,
      },
      {
        source_id: "source-1",
        display: "HR",
        key: null,
        version: "v-2026-08-02",
        fetched_at: FETCHED_AT,
      },
    ]);
  });

  it("produces no rows for an empty set", () => {
    expect(toEntryRows("source-1", { entries: [], version: "v1", fetchedAt: FETCHED_AT })).toEqual(
      [],
    );
  });
});

describe("toCachedValueSet", () => {
  it("reads the version and fetch time from the active rows", () => {
    const cached = toCachedValueSet([
      entryRow(),
      entryRow({ id: "entry-2", display: "HR", key: "HR-002" }),
    ]);

    expect(cached).toEqual({
      entries: [
        { display: "Finance", key: "FIN-001" },
        { display: "HR", key: "HR-002" },
      ],
      version: "v-2026-08-02",
      fetchedAt: FETCHED_AT,
    });
  });

  it("omits an absent key rather than carrying a null", () => {
    const cached = toCachedValueSet([entryRow({ key: null })]);

    expect(cached?.entries[0]).toEqual({ display: "Finance" });
  });

  it("returns null when the source has never been cached", () => {
    expect(toCachedValueSet([])).toBeNull();
  });
});
