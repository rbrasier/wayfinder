import { describe, it, expect } from "vitest";
import {
  classifyValueSetMatch,
  parseTemplateField,
  rankValueSetCandidates,
  type IValueSetProvider,
  type ResolveOutcome,
  type TemplateField,
  type ValueSetEntry,
  type ValueSetListing,
  type ValueSetMatchInput,
  type ValueSetProbe,
} from "@rbrasier/domain";
import { describeExternalFieldFlag, validateExternalFields } from "./validate-external-fields";

const field = (rawTag: string): TemplateField => {
  const parsed = parseTemplateField(rawTag);
  if (parsed.error) throw new Error(parsed.error.message);
  return parsed.data;
};

const departments: ValueSetEntry[] = [
  { display: "Finance", key: "FIN-001" },
  { display: "Human Resources", key: "HR-002" },
  { display: "Operations", key: "OPS-003" },
  { display: "Operations", key: "OPS-009" },
];

const VERSION = "2026-07-01T09:00:00.000Z";
const FETCHED_AT = new Date("2026-07-01T09:00:00.000Z");

interface FakeProviderOptions {
  stale?: boolean;
  failing?: boolean;
  matchFailing?: boolean;
}

// Resolves against a fixed set with the canonicalisation the real adapters
// perform: case-insensitive match on display, duplicates reported as ambiguous.
class FakeValueSetProvider implements IValueSetProvider {
  readonly resolveCalls: Array<{ sourceName: string; values: string[] }> = [];

  constructor(
    private readonly sets: Record<string, ValueSetEntry[]>,
    private readonly options: FakeProviderOptions = {},
  ) {}

  async search(): Promise<{ data: ValueSetEntry[] }> {
    return { data: [] };
  }

  async list(sourceName: string): Promise<{ data: ValueSetListing }> {
    return {
      data: {
        entries: this.sets[sourceName] ?? [],
        version: VERSION,
        fetchedAt: FETCHED_AT,
        stale: false,
      },
    };
  }

  async probe(): Promise<{ data: ValueSetProbe }> {
    return { data: { collections: [] } };
  }

  readonly matchCalls: ValueSetMatchInput[] = [];

  async match(input: ValueSetMatchInput) {
    this.matchCalls.push(input);
    if (this.options.matchFailing) {
      return { error: { code: "INFRA_FAILURE" as const, message: "source unreachable" } };
    }

    const entries = this.sets[input.sourceName] ?? [];
    return {
      data: {
        matches: input.values.map((value) => ({
          input: value,
          outcome: classifyValueSetMatch(rankValueSetCandidates(entries, value)),
        })),
        stale: this.options.stale ?? false,
        version: VERSION,
        fetchedAt: FETCHED_AT,
      },
    };
  }

  async resolve(sourceName: string, values: string[]) {
    this.resolveCalls.push({ sourceName, values });

    if (this.options.failing) {
      return { error: { code: "INFRA_FAILURE" as const, message: "source unreachable" } };
    }

    const entries = this.sets[sourceName] ?? [];
    const matched: ResolveOutcome["matched"] = [];
    const unresolved: string[] = [];
    const ambiguous: string[] = [];

    values.forEach((value) => {
      const hits = entries.filter(
        (entry) => entry.display.toLowerCase() === value.trim().toLowerCase(),
      );
      if (hits.length === 0) {
        unresolved.push(value);
        return;
      }
      if (hits.length > 1) {
        ambiguous.push(value);
        return;
      }
      matched.push({ input: value, entry: hits[0]! });
    });

    return {
      data: {
        matched,
        unresolved,
        ambiguous,
        stale: this.options.stale ?? false,
        version: VERSION,
        fetchedAt: FETCHED_AT,
      },
    };
  }
}

describe("validateExternalFields", () => {
  it("canonicalises a valid value and attaches its key and snapshot", async () => {
    const provider = new FakeValueSetProvider({ departments });

    const result = await validateExternalFields(provider, {
      fields: [field("Department (options-source: departments)")],
      values: { department: "finance" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.resolved.department).toEqual({
      value: "Finance",
      valueKey: "FIN-001",
      sourceRef: { name: "departments", version: VERSION, fetchedAt: FETCHED_AT },
    });
    expect(result.data?.flagged).toEqual([]);
    expect(result.data?.blocksCompletion).toBe(false);
  });

  it("stores the display alone when the source declares no key", async () => {
    const provider = new FakeValueSetProvider({ teams: [{ display: "Alpha" }] });

    const result = await validateExternalFields(provider, {
      fields: [field("Team (options-source: teams)")],
      values: { team: "Alpha" },
    });

    expect(result.data?.resolved.team?.value).toBe("Alpha");
    expect(result.data?.resolved.team?.valueKey).toBeUndefined();
  });

  it("flags an unknown value and blocks step completion", async () => {
    const provider = new FakeValueSetProvider({ departments });

    const result = await validateExternalFields(provider, {
      fields: [field("Department (options-source: departments)")],
      values: { department: "Marketing" },
    });

    expect(result.data?.blocksCompletion).toBe(true);
    expect(result.data?.flagged).toEqual([
      {
        fieldKey: "department",
        label: "Department",
        value: "Marketing",
        reason: "unresolved",
        sourceName: "departments",
      },
    ]);
    expect(result.data?.resolved.department).toBeUndefined();
  });

  it("rejects a value matching two entries with distinct keys as ambiguous", async () => {
    const provider = new FakeValueSetProvider({ departments });

    const result = await validateExternalFields(provider, {
      fields: [field("Department (options-source: departments)")],
      values: { department: "Operations" },
    });

    expect(result.data?.blocksCompletion).toBe(true);
    expect(result.data?.flagged[0]?.reason).toBe("ambiguous");
  });

  it("batches every field of one source into a single resolve call", async () => {
    const provider = new FakeValueSetProvider({ departments });

    await validateExternalFields(provider, {
      fields: [
        field("Department (options-source: departments)"),
        field("Owning Department (options-source: departments)"),
      ],
      values: { department: "Finance", owning_department: "Human Resources" },
    });

    expect(provider.resolveCalls).toHaveLength(1);
    expect(provider.resolveCalls[0]?.values).toEqual(["Finance", "Human Resources"]);
  });

  it("resolves every selected value of a multi-select field", async () => {
    const provider = new FakeValueSetProvider({ departments });

    const result = await validateExternalFields(provider, {
      fields: [field("Departments (options-source: departments) (multiple)")],
      values: { departments: "finance, human resources" },
    });

    expect(result.data?.resolved.departments).toEqual({
      value: "Finance, Human Resources",
      valueKey: "FIN-001, HR-002",
      sourceRef: { name: "departments", version: VERSION, fetchedAt: FETCHED_AT },
    });
    expect(result.data?.blocksCompletion).toBe(false);
  });

  it("blocks when one value of a multi-select field is unknown", async () => {
    const provider = new FakeValueSetProvider({ departments });

    const result = await validateExternalFields(provider, {
      fields: [field("Departments (options-source: departments) (multiple)")],
      values: { departments: "Finance, Marketing" },
    });

    expect(result.data?.blocksCompletion).toBe(true);
    expect(result.data?.flagged[0]?.value).toBe("Marketing");
  });

  it("accepts and flags rather than blocking when the set is last-known-good", async () => {
    const provider = new FakeValueSetProvider({ departments }, { stale: true });

    const result = await validateExternalFields(provider, {
      fields: [field("Department (options-source: departments)")],
      values: { department: "Marketing" },
    });

    expect(result.data?.blocksCompletion).toBe(false);
    expect(result.data?.flagged[0]?.reason).toBe("stale");
    expect(result.data?.resolved.department?.value).toBe("Marketing");
  });

  it("degrades without throwing when the provider fails outright", async () => {
    const provider = new FakeValueSetProvider({ departments }, { failing: true });

    const result = await validateExternalFields(provider, {
      fields: [field("Department (options-source: departments)")],
      values: { department: "Finance" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.blocksCompletion).toBe(false);
    expect(result.data?.flagged[0]?.reason).toBe("stale");
  });

  it("ignores fields that are not bound to a source", async () => {
    const provider = new FakeValueSetProvider({ departments });

    const result = await validateExternalFields(provider, {
      fields: [field("Client Name"), field("Department (options-source: departments)")],
      values: { client_name: "Acme", department: "Finance" },
    });

    expect(Object.keys(result.data?.resolved ?? {})).toEqual(["department"]);
    expect(provider.resolveCalls[0]?.values).toEqual(["Finance"]);
  });

  it("skips a blank value, leaving requiredness to the existing field validation", async () => {
    const provider = new FakeValueSetProvider({ departments });

    const result = await validateExternalFields(provider, {
      fields: [field("Department (options-source: departments)")],
      values: { department: "   " },
    });

    expect(provider.resolveCalls).toHaveLength(0);
    expect(result.data?.flagged).toEqual([]);
    expect(result.data?.blocksCompletion).toBe(false);
  });
});

describe("validateExternalFields — suggestions", () => {
  const departmentField = field("Department (options-source: departments)");

  it("offers what the operator probably meant when a value does not exist", async () => {
    const provider = new FakeValueSetProvider({ departments });

    const result = await validateExternalFields(provider, {
      fields: [departmentField],
      values: { department: "Finence" },
    });

    expect(result.data?.flagged[0]?.suggestions).toEqual([{ display: "Finance", key: "FIN-001" }]);
  });

  it("still blocks the step — a suggestion is not a substitution", async () => {
    const provider = new FakeValueSetProvider({ departments });

    const result = await validateExternalFields(provider, {
      fields: [departmentField],
      values: { department: "Finence" },
    });

    expect(result.data?.blocksCompletion).toBe(true);
    expect(result.data?.resolved.department).toBeUndefined();
  });

  it("offers both entries when the value is ambiguous between them", async () => {
    const provider = new FakeValueSetProvider({ departments });

    const result = await validateExternalFields(provider, {
      fields: [departmentField],
      values: { department: "Operations" },
    });

    expect(result.data?.flagged[0]?.suggestions).toEqual([
      { display: "Operations", key: "OPS-003" },
      { display: "Operations", key: "OPS-009" },
    ]);
  });

  it("does not narrow a stale flag, whose value stands as the operator typed it", async () => {
    const provider = new FakeValueSetProvider({ departments }, { stale: true });

    const result = await validateExternalFields(provider, {
      fields: [departmentField],
      values: { department: "Finence" },
    });

    expect(provider.matchCalls).toEqual([]);
    expect(result.data?.flagged[0]?.suggestions).toBeUndefined();
  });

  it("leaves the block in place without suggestions when narrowing itself fails", async () => {
    const provider = new FakeValueSetProvider({ departments }, { matchFailing: true });

    const result = await validateExternalFields(provider, {
      fields: [departmentField],
      values: { department: "Finence" },
    });

    expect(result.error).toBeUndefined();
    expect(result.data?.blocksCompletion).toBe(true);
    expect(result.data?.flagged[0]?.suggestions).toBeUndefined();
  });

  it("narrows a source once for every value that failed against it", async () => {
    const provider = new FakeValueSetProvider({ departments });

    await validateExternalFields(provider, {
      fields: [departmentField, field("Owner (options-source: departments)")],
      values: { department: "Finence", owner: "Humn Resources" },
    });

    expect(provider.matchCalls).toHaveLength(1);
    expect(provider.matchCalls[0]?.values).toEqual(["Finence", "Humn Resources"]);
  });

  it("says nothing about a value with no plausible neighbour", async () => {
    const provider = new FakeValueSetProvider({ departments });

    const result = await validateExternalFields(provider, {
      fields: [departmentField],
      values: { department: "aardvark" },
    });

    expect(result.data?.flagged[0]?.suggestions).toBeUndefined();
  });
});

describe("describeExternalFieldFlag", () => {
  it("names the field and the value that failed", () => {
    expect(
      describeExternalFieldFlag({
        fieldKey: "department",
        label: "Department",
        value: "Finence",
        reason: "unresolved",
        sourceName: "departments",
      }),
    ).toBe('"Department" (Finence)');
  });

  it("adds the shortlist with codes, so two similar entries can be told apart", () => {
    expect(
      describeExternalFieldFlag({
        fieldKey: "department",
        label: "Department",
        value: "Operations",
        reason: "ambiguous",
        sourceName: "departments",
        suggestions: [
          { display: "Operations", key: "OPS-003" },
          { display: "Operations", key: "OPS-009" },
        ],
      }),
    ).toBe('"Department" (Operations) — did you mean Operations (OPS-003), Operations (OPS-009)?');
  });
});
