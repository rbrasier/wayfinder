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
  credential: null,
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
  credential: "Bearer plaintext-secret",
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
      credentialSet: false,
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

  it("reports no credential when the column is empty", () => {
    expect(toLookupSource(sourceRow({ credential: null })).credentialSet).toBe(false);
  });

  it("reports that a credential exists without exposing the ciphertext", () => {
    const source = toLookupSource(sourceRow({ credential: "enc:v1:abcdef" }));

    expect(source.credentialSet).toBe(true);
    expect(JSON.stringify(source)).not.toContain("abcdef");
  });
});

describe("toLookupSourceColumns", () => {
  const encrypt = (plaintext: string) => `enc(${plaintext})`;

  it("writes snake_case columns and nulls the optional fields", () => {
    const columns = toLookupSourceColumns(
      { ...draft, keyField: undefined, credential: undefined },
      encrypt,
    );

    expect(columns.display_field).toBe("department");
    expect(columns.key_field).toBeNull();
  });

  it("encrypts the credential rather than storing what the admin typed", () => {
    const columns = toLookupSourceColumns(draft, encrypt);

    expect(columns.credential).toBe("enc(Bearer plaintext-secret)");
    expect(columns.credential).not.toBe(draft.credential);
  });

  it("omits the column entirely when no credential was supplied, keeping the stored one", () => {
    const columns = toLookupSourceColumns({ ...draft, credential: undefined }, encrypt);

    expect("credential" in columns).toBe(false);
  });

  it("clears the stored credential when an empty one is supplied", () => {
    const columns = toLookupSourceColumns({ ...draft, credential: "" }, encrypt);

    expect(columns.credential).toBeNull();
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
