import { describe, it, expect } from "vitest";
import {
  INLINE_OPTIONS_THRESHOLD,
  parseTemplateField,
  type IValueSetProvider,
  type TemplateField,
  type ValueSetEntry,
  type ValueSetListing,
  type ValueSetProbe,
} from "@rbrasier/domain";
import { buildExternalOptionsPreview, inlineExternalOptions } from "./external-options";

const field = (rawTag: string): TemplateField => {
  const parsed = parseTemplateField(rawTag);
  if (parsed.error) throw new Error(parsed.error.message);
  return parsed.data;
};

const entriesOfSize = (count: number): ValueSetEntry[] =>
  Array.from({ length: count }, (_, index) => ({
    display: `Department ${index + 1}`,
    key: `D-${index + 1}`,
  }));

class FakeValueSetProvider implements IValueSetProvider {
  readonly listCalls: string[] = [];

  constructor(
    private readonly sets: Record<string, ValueSetEntry[]>,
    private readonly failing = false,
  ) {}

  async list(sourceName: string) {
    this.listCalls.push(sourceName);
    if (this.failing) {
      return { error: { code: "INFRA_FAILURE" as const, message: "source unreachable" } };
    }
    const listing: ValueSetListing = {
      entries: this.sets[sourceName] ?? [],
      version: "v1",
      fetchedAt: new Date("2026-07-01T09:00:00.000Z"),
      stale: false,
    };
    return { data: listing };
  }

  async search(): Promise<{ data: ValueSetEntry[] }> {
    return { data: [] };
  }

  async resolve() {
    return {
      data: {
        matched: [],
        unresolved: [],
        ambiguous: [],
        stale: false,
        version: "v1",
        fetchedAt: new Date(0),
      },
    };
  }

  async probe(): Promise<{ data: ValueSetProbe }> {
    return { data: { fields: [], sample: [] } };
  }
}

describe("inlineExternalOptions", () => {
  it("inlines a small set as 'display (key)' so the model can propose unambiguously", async () => {
    const provider = new FakeValueSetProvider({
      departments: [
        { display: "Finance", key: "FIN-001" },
        { display: "HR", key: "HR-002" },
      ],
    });

    const fields = await inlineExternalOptions(provider, [
      field("Department (options-source: departments)"),
    ]);

    expect(fields[0]?.options).toEqual(["Finance (FIN-001)", "HR (HR-002)"]);
  });

  it("inlines the display alone when the source declares no key", async () => {
    const provider = new FakeValueSetProvider({ teams: [{ display: "Alpha" }] });

    const fields = await inlineExternalOptions(provider, [field("Team (options-source: teams)")]);

    expect(fields[0]?.options).toEqual(["Alpha"]);
  });

  it("inlines a set exactly at the threshold", async () => {
    const provider = new FakeValueSetProvider({
      departments: entriesOfSize(INLINE_OPTIONS_THRESHOLD),
    });

    const fields = await inlineExternalOptions(provider, [
      field("Department (options-source: departments)"),
    ]);

    expect(fields[0]?.options).toHaveLength(INLINE_OPTIONS_THRESHOLD);
  });

  it("leaves a large set out of the prompt, deferring to the step-end resolve", async () => {
    const provider = new FakeValueSetProvider({
      departments: entriesOfSize(INLINE_OPTIONS_THRESHOLD + 1),
    });

    const fields = await inlineExternalOptions(provider, [
      field("Department (options-source: departments)"),
    ]);

    expect(fields[0]?.options).toBeUndefined();
    expect(fields[0]?.optionsSource).toBe("departments");
  });

  it("attaches a few real values from a large set as examples", async () => {
    const provider = new FakeValueSetProvider({
      departments: entriesOfSize(INLINE_OPTIONS_THRESHOLD + 20),
    });

    const fields = await inlineExternalOptions(provider, [
      field("Department (options-source: departments)"),
    ]);

    expect(fields[0]?.optionsSample).toEqual([
      "Department 1 (D-1)",
      "Department 2 (D-2)",
      "Department 3 (D-3)",
    ]);
  });

  it("does not attach a sample to an inlined set, which already carries them all", async () => {
    const provider = new FakeValueSetProvider({ departments: entriesOfSize(5) });

    const fields = await inlineExternalOptions(provider, [
      field("Department (options-source: departments)"),
    ]);

    expect(fields[0]?.optionsSample).toBeUndefined();
    expect(fields[0]?.options).toHaveLength(5);
  });

  it("attaches nothing when the source is empty", async () => {
    const provider = new FakeValueSetProvider({ departments: [] });

    const fields = await inlineExternalOptions(provider, [
      field("Department (options-source: departments)"),
    ]);

    expect(fields[0]?.options).toBeUndefined();
    expect(fields[0]?.optionsSample).toBeUndefined();
  });

  it("degrades without throwing when the provider fails", async () => {
    const provider = new FakeValueSetProvider({}, true);

    const fields = await inlineExternalOptions(provider, [
      field("Department (options-source: departments)"),
    ]);

    expect(fields[0]?.options).toBeUndefined();
  });

  it("reads each source once however many fields reference it", async () => {
    const provider = new FakeValueSetProvider({ departments: [{ display: "Finance" }] });

    await inlineExternalOptions(provider, [
      field("Department (options-source: departments)"),
      field("Owning Department (options-source: departments)"),
    ]);

    expect(provider.listCalls).toEqual(["departments"]);
  });

  it("leaves fields with no source untouched and calls nothing", async () => {
    const provider = new FakeValueSetProvider({});

    const fields = await inlineExternalOptions(provider, [
      field("Client Name"),
      field("Status (options: Open, Closed)"),
    ]);

    expect(provider.listCalls).toEqual([]);
    expect(fields[1]?.options).toEqual(["Open", "Closed"]);
  });

  it("returns the fields unchanged when no provider is wired", async () => {
    const fields = await inlineExternalOptions(undefined, [
      field("Department (options-source: departments)"),
    ]);

    expect(fields[0]?.options).toBeUndefined();
  });
});

describe("buildExternalOptionsPreview", () => {
  it("shows three options and offers the rest, independent of inlining", () => {
    const preview = buildExternalOptionsPreview(entriesOfSize(12));

    expect(preview.shown).toHaveLength(3);
    expect(preview.remaining).toBe(9);
    expect(preview.text).toBe(
      "Department 1 (D-1), Department 2 (D-2), Department 3 (D-3) — ask to see all 12 options",
    );
  });

  it("caps a small, fully inlined set at three all the same", () => {
    const preview = buildExternalOptionsPreview(entriesOfSize(5));

    expect(preview.shown).toHaveLength(3);
    expect(preview.text).toContain("ask to see all 5 options");
  });

  it("offers nothing extra when the whole set is already shown", () => {
    const preview = buildExternalOptionsPreview([{ display: "Finance", key: "FIN-001" }]);

    expect(preview.text).toBe("Finance (FIN-001)");
    expect(preview.remaining).toBe(0);
  });

  it("returns empty text for an empty set", () => {
    expect(buildExternalOptionsPreview([]).text).toBe("");
  });
});
