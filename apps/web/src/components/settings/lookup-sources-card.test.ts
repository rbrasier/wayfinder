import { describe, expect, it } from "vitest";
import {
  collectionLabel,
  draftSaveBlocker,
  draftToConfig,
  draftToInput,
  duplicateManagedRow,
  emptyDraft,
  emptyManagedRow,
  fieldsForCollection,
  removeManagedRow,
  toManagedEntries,
  toManagedRows,
  updateManagedRow,
  previewRows,
  sampleForCollection,
  type LookupSourceDraft,
} from "./lookup-sources-card";

const apiDraft = (overrides: Partial<LookupSourceDraft> = {}): LookupSourceDraft => ({
  ...emptyDraft(),
  name: "departments",
  label: "Departments",
  kind: "api",
  url: "https://directory.example.gov/departments",
  displayField: "department",
  keyField: "department_code",
  ...overrides,
});

describe("draftToConfig", () => {
  it("writes only the api fields for an api source", () => {
    const config = draftToConfig(apiDraft({ searchParam: "q", recordsPath: "result.items" }));

    expect(config).toEqual({
      url: "https://directory.example.gov/departments",
      searchParam: "q",
      recordsPath: "result.items",
    });
  });

  it("omits blank optional api fields", () => {
    expect(draftToConfig(apiDraft())).toEqual({
      url: "https://directory.example.gov/departments",
    });
  });

  it("drops a stale URL when the kind is switched away from api", () => {
    const config = draftToConfig(apiDraft({ kind: "managed" }));

    expect(config).toEqual({});
  });

  it("writes the scope for a directory source", () => {
    const config = draftToConfig(apiDraft({ kind: "directory", directoryQuery: "finance" }));

    expect(config).toEqual({ query: "finance" });
  });

  it("writes nothing for a directory source with no scope", () => {
    expect(draftToConfig(apiDraft({ kind: "directory" }))).toEqual({});
  });
});

describe("draftToInput", () => {
  it("trims the values an admin typed", () => {
    const input = draftToInput(apiDraft({ name: "  departments  ", label: " Departments " }));

    expect(input.name).toBe("departments");
    expect(input.label).toBe("Departments");
  });

  it("omits an unset key field rather than sending an empty string", () => {
    const input = draftToInput(apiDraft({ keyField: "" }));

    expect("keyField" in input).toBe(false);
  });

  it("omits a blank credential, so an edit keeps the stored secret", () => {
    expect("credential" in draftToInput(apiDraft())).toBe(false);
  });

  it("carries a credential the admin typed", () => {
    const input = draftToInput(apiDraft({ credential: "Bearer abc123" }));

    expect(input.credential).toBe("Bearer abc123");
  });
});

describe("draftSaveBlocker", () => {
  it("allows a complete draft", () => {
    expect(draftSaveBlocker(apiDraft())).toBeNull();
  });

  it("requires a name", () => {
    expect(draftSaveBlocker(apiDraft({ name: "" }))).toContain("name");
  });

  it("requires the name to be a slug, since templates reference it", () => {
    expect(draftSaveBlocker(apiDraft({ name: "My Departments" }))).toContain("lowercase");
  });

  it("requires a label", () => {
    expect(draftSaveBlocker(apiDraft({ label: "" }))).toContain("label");
  });

  it("requires a URL for an api source", () => {
    expect(draftSaveBlocker(apiDraft({ url: "" }))).toContain("URL");
  });

  it("does not require a URL for a managed source", () => {
    expect(draftSaveBlocker(apiDraft({ kind: "managed", url: "" }))).toBeNull();
  });

  it("blocks saving until a display field has been chosen", () => {
    expect(draftSaveBlocker(apiDraft({ displayField: "" }))).toContain("Test the source");
  });

  it("does not require a key field", () => {
    expect(draftSaveBlocker(apiDraft({ keyField: "" }))).toBeNull();
  });
});

describe("previewRows", () => {
  const sample = [
    { department: "Finance", department_code: "FIN-001" },
    { department: "Human Resources", department_code: "HR-002" },
  ];

  it("renders each sampled record as 'display (key)'", () => {
    expect(previewRows(sample, "department", "department_code")).toEqual([
      "Finance (FIN-001)",
      "Human Resources (HR-002)",
    ]);
  });

  it("renders the display alone when no key field is chosen", () => {
    expect(previewRows(sample, "department", "")).toEqual(["Finance", "Human Resources"]);
  });

  it("shows nothing until a display field is chosen", () => {
    expect(previewRows(sample, "", "department_code")).toEqual([]);
  });

  it("skips a record with no value in the display field", () => {
    expect(previewRows([{ department_code: "FIN-001" }], "department", "department_code")).toEqual(
      [],
    );
  });
});

describe("collection helpers", () => {
  const collections = [
    {
      path: "",
      count: 3,
      fields: ["name"],
      sample: [{ name: "Root" }],
    },
    {
      path: "result.items",
      count: 12,
      fields: ["department", "department_code", "portfolio", "active", "extra"],
      sample: [{ department: "Finance", department_code: "FIN-001" }],
    },
  ];

  it("labels the response itself rather than showing an empty path", () => {
    expect(collectionLabel(collections[0]!)).toBe("(whole response) · 3 records · name");
  });

  it("calls a zero-count entry the saved mapping rather than an empty list", () => {
    const seeded = { path: "result.items", count: 0, fields: ["department"], sample: [] };

    expect(collectionLabel(seeded)).toBe("result.items · saved mapping · department");
  });

  it("labels a nested list with its path, count and first few fields", () => {
    expect(collectionLabel(collections[1]!)).toBe(
      "result.items · 12 records · department, department_code, portfolio, active",
    );
  });

  it("scopes the selectable fields to the chosen list", () => {
    expect(fieldsForCollection(collections, "")).toEqual(["name"]);
    expect(fieldsForCollection(collections, "result.items")).toContain("department_code");
  });

  it("offers no fields for a list that is not there", () => {
    expect(fieldsForCollection(collections, "missing")).toEqual([]);
    expect(sampleForCollection(collections, "missing")).toEqual([]);
  });

  it("takes the sample from the chosen list", () => {
    expect(sampleForCollection(collections, "result.items")).toEqual([
      { department: "Finance", department_code: "FIN-001" },
    ]);
  });
});

describe("managed sources", () => {
  it("uses the fixed managed field names rather than asking the admin to choose", () => {
    const input = draftToInput({ ...emptyDraft(), name: "cost-centres", label: "Cost Centres", kind: "managed" });

    expect(input.displayField).toBe("display");
    expect(input.keyField).toBe("key");
  });

  it("can be saved without running Test, which it has nothing to run against", () => {
    const draft = { ...emptyDraft(), name: "cost-centres", label: "Cost Centres", kind: "managed" as const };

    expect(draftSaveBlocker(draft)).toBeNull();
  });
});

describe("managed row editing", () => {
  const rows = [
    { display: "Corporate Services", key: "CC-100" },
    { display: "Field Operations", key: "CC-200" },
  ];

  it("seeds the editor from the stored values", () => {
    expect(toManagedRows([{ display: "Corporate", key: "CC-100" }, { display: "Field" }])).toEqual([
      { display: "Corporate", key: "CC-100" },
      { display: "Field", key: "" },
    ]);
  });

  it("trims the rows and drops the blank slots on the way out", () => {
    const entries = toManagedEntries([
      { display: "  Corporate  ", key: " CC-100 " },
      { display: "", key: "" },
    ]);

    expect(entries).toEqual([{ display: "Corporate", key: "CC-100" }]);
  });

  it("omits an empty code rather than storing a blank one", () => {
    expect(toManagedEntries([{ display: "Corporate", key: "  " }])).toEqual([
      { display: "Corporate" },
    ]);
  });

  it("edits one row without disturbing the others", () => {
    const updated = updateManagedRow(rows, 1, { key: "CC-999" });

    expect(updated[0]).toEqual(rows[0]);
    expect(updated[1]).toEqual({ display: "Field Operations", key: "CC-999" });
  });

  it("removes the row at the given position", () => {
    expect(removeManagedRow(rows, 0)).toEqual([rows[1]]);
  });

  it("flags two rows that are the same value twice", () => {
    expect(
      duplicateManagedRow([...rows, { display: "corporate services", key: "cc-100" }]),
    ).toBe(2);
  });

  it("allows the same label under two different codes", () => {
    expect(
      duplicateManagedRow([
        { display: "Operations", key: "OPS-1" },
        { display: "Operations", key: "OPS-2" },
      ]),
    ).toBeNull();
  });

  it("ignores blank slots when checking for duplicates", () => {
    expect(duplicateManagedRow([emptyManagedRow(), emptyManagedRow()])).toBeNull();
  });
});
