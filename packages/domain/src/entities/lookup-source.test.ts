import { describe, it, expect } from "vitest";
import {
  CONVERSATION_PREVIEW_LIMIT,
  DEFAULT_CACHE_TTL_SECONDS,
  INLINE_OPTIONS_THRESHOLD,
  entriesMatchVersion,
  formatValueSetEntry,
  isLookupSourceKind,
  previewValueSetEntries,
  probeFieldNames,
  validateNewLookupSource,
} from "./lookup-source";
import type { NewLookupSource, ValueSetEntry } from "./lookup-source";

const validSource: NewLookupSource = {
  name: "departments",
  label: "Departments",
  kind: "directory",
  config: {},
  displayField: "department",
  keyField: "department_code",
  cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
  enabled: true,
};

describe("formatValueSetEntry", () => {
  it("renders display and key as 'display (key)'", () => {
    expect(formatValueSetEntry({ display: "Finance", key: "FIN-001" })).toBe("Finance (FIN-001)");
  });

  it("renders the display alone when there is no key", () => {
    expect(formatValueSetEntry({ display: "Finance" })).toBe("Finance");
  });

  it("renders the display alone rather than empty parentheses for a blank key", () => {
    expect(formatValueSetEntry({ display: "Finance", key: "" })).toBe("Finance");
  });
});

describe("previewValueSetEntries", () => {
  const entries: ValueSetEntry[] = [
    { display: "Finance" },
    { display: "HR" },
    { display: "Legal" },
    { display: "Operations" },
    { display: "Estates" },
  ];

  it("caps the preview at three entries and reports the remainder", () => {
    const preview = previewValueSetEntries(entries);

    expect(preview.shown).toHaveLength(CONVERSATION_PREVIEW_LIMIT);
    expect(preview.shown.map((entry) => entry.display)).toEqual(["Finance", "HR", "Legal"]);
    expect(preview.remaining).toBe(2);
    expect(preview.totalCount).toBe(5);
  });

  it("reports no remainder when the set already fits", () => {
    const preview = previewValueSetEntries(entries.slice(0, 2));

    expect(preview.shown).toHaveLength(2);
    expect(preview.remaining).toBe(0);
  });

  it("caps at three even for a small set that would be fully inlined into the prompt", () => {
    const smallInlinedSet = entries.slice(0, 4);

    expect(smallInlinedSet.length).toBeLessThanOrEqual(INLINE_OPTIONS_THRESHOLD);
    expect(previewValueSetEntries(smallInlinedSet).shown).toHaveLength(3);
  });

  it("returns an empty preview for an empty set", () => {
    const preview = previewValueSetEntries([]);

    expect(preview.shown).toEqual([]);
    expect(preview.remaining).toBe(0);
    expect(preview.totalCount).toBe(0);
  });
});

describe("isLookupSourceKind", () => {
  it("accepts the three shipped kinds", () => {
    expect(isLookupSourceKind("directory")).toBe(true);
    expect(isLookupSourceKind("managed")).toBe(true);
    expect(isLookupSourceKind("api")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isLookupSourceKind("http")).toBe(false);
    expect(isLookupSourceKind("")).toBe(false);
  });
});

describe("validateNewLookupSource", () => {
  it("accepts a well-formed source", () => {
    const result = validateNewLookupSource(validSource);

    expect(result.error).toBeUndefined();
    expect(result.data?.name).toBe("departments");
  });

  it("accepts a source with no key field", () => {
    const result = validateNewLookupSource({ ...validSource, keyField: undefined });

    expect(result.error).toBeUndefined();
    expect(result.data?.keyField).toBeUndefined();
  });

  it("rejects a name that is not a slug", () => {
    const result = validateNewLookupSource({ ...validSource, name: "My Departments" });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("lowercase");
  });

  it("rejects a missing display field", () => {
    const result = validateNewLookupSource({ ...validSource, displayField: "  " });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("display field");
  });

  it("rejects an unknown kind", () => {
    const result = validateNewLookupSource({
      ...validSource,
      kind: "ftp" as NewLookupSource["kind"],
    });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a non-positive cache TTL", () => {
    const result = validateNewLookupSource({ ...validSource, cacheTtlSeconds: 0 });

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toContain("cache TTL");
  });

  it("trims surrounding whitespace from the name and fields", () => {
    const result = validateNewLookupSource({
      ...validSource,
      name: "  departments  ",
      displayField: " department ",
      keyField: " department_code ",
    });

    expect(result.data?.name).toBe("departments");
    expect(result.data?.displayField).toBe("department");
    expect(result.data?.keyField).toBe("department_code");
  });
});

describe("probeFieldNames", () => {
  it("collects the union of field names across the sample", () => {
    const fields = probeFieldNames([
      { department: "Finance", department_code: "FIN-001" },
      { department: "HR", cost_centre: "CC-2" },
    ]);

    expect(fields).toEqual(["department", "department_code", "cost_centre"]);
  });

  it("returns an empty list for an empty sample", () => {
    expect(probeFieldNames([])).toEqual([]);
  });
});

describe("entriesMatchVersion", () => {
  const finance: ValueSetEntry = { display: "Finance", key: "FIN-001" };
  const humanResources: ValueSetEntry = { display: "HR", key: "HR-002" };
  const current: ValueSetEntry[] = [finance, humanResources];

  it("treats identical content as unchanged so the version is reused", () => {
    expect(entriesMatchVersion(current, [...current])).toBe(true);
  });

  it("ignores ordering, which the source does not guarantee", () => {
    expect(entriesMatchVersion(current, [humanResources, finance])).toBe(true);
  });

  it("detects a changed key on the same display", () => {
    expect(
      entriesMatchVersion(current, [{ display: "Finance", key: "FIN-009" }, humanResources]),
    ).toBe(false);
  });

  it("detects a removed entry", () => {
    expect(entriesMatchVersion(current, [finance])).toBe(false);
  });
});
