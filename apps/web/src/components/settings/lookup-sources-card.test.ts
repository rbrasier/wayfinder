import { describe, expect, it } from "vitest";
import {
  draftSaveBlocker,
  draftToConfig,
  draftToInput,
  emptyDraft,
  previewRows,
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

  it("omits an unset credential reference", () => {
    expect("credentialRef" in draftToInput(apiDraft())).toBe(false);
  });

  it("carries a credential reference when one is given", () => {
    const input = draftToInput(apiDraft({ credentialRef: "LOOKUP_CRED_DEPARTMENTS" }));

    expect(input.credentialRef).toBe("LOOKUP_CRED_DEPARTMENTS");
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
