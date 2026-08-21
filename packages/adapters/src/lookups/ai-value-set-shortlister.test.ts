import { describe, expect, it, vi } from "vitest";
import {
  domainError,
  err,
  ok,
  type GenerateObjectInput,
  type ILanguageModel,
  type Result,
  type TokenUsage,
  SHORTLIST_ENTRY_BUDGET,
  type ValueSetEntry,
} from "@rbrasier/domain";
import { AiValueSetShortlister, sampleForShortlist } from "./ai-value-set-shortlister";

const usage: TokenUsage = {
  promptTokens: 0,
  completionTokens: 0,
  systemTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

const stubModel = (
  generate: (input: GenerateObjectInput) => Promise<Result<{ object: unknown; usage: TokenUsage }>>,
): ILanguageModel =>
  ({
    provider: "anthropic",
    generateObject: vi.fn(generate),
    generateText: vi.fn(),
    streamText: vi.fn(),
    streamObject: vi.fn(),
  }) as unknown as ILanguageModel;

const departments: ValueSetEntry[] = [
  { display: "Finance", key: "FIN-001" },
  { display: "Human Resources", key: "HR-001" },
  { display: "Corporate Services", key: "CS-001" },
];

const choice = (key: string) => ({ key, display: "" });

describe("AiValueSetShortlister", () => {
  it("returns the entries the model chose, in the order it ranked them", async () => {
    const model = stubModel(async () =>
      ok({ object: { choices: [choice("CS-001"), choice("FIN-001")] }, usage }),
    );
    const shortlister = new AiValueSetShortlister(model);

    const result = await shortlister.shortlist({
      query: "procurement",
      entries: departments,
      limit: 5,
    });

    expect(result.data?.map((candidate) => candidate.entry.key)).toEqual(["CS-001", "FIN-001"]);
  });

  it("marks every candidate as inferred, so none of them can auto-resolve", async () => {
    const model = stubModel(async () => ok({ object: { choices: [choice("FIN-001")] }, usage }));

    const result = await new AiValueSetShortlister(model).shortlist({
      query: "procurement",
      entries: departments,
      limit: 5,
    });

    expect(result.data?.[0]?.tier).toBe("inferred");
  });

  it("scores candidates in descending rank order so a merged list keeps the ranking", async () => {
    const model = stubModel(async () =>
      ok({ object: { choices: [choice("CS-001"), choice("FIN-001"), choice("HR-001")] }, usage }),
    );

    const result = await new AiValueSetShortlister(model).shortlist({
      query: "procurement",
      entries: departments,
      limit: 5,
    });

    const scores = result.data?.map((candidate) => candidate.score) ?? [];
    expect(scores).toEqual([...scores].sort((left, right) => right - left));
    expect(new Set(scores).size).toBe(scores.length);
  });

  it("drops an option the model invented rather than offering a value that is not in the set", async () => {
    const model = stubModel(async () =>
      ok({ object: { choices: [choice("FIN-001"), choice("GHOST-9")] }, usage }),
    );

    const result = await new AiValueSetShortlister(model).shortlist({
      query: "procurement",
      entries: departments,
      limit: 5,
    });

    expect(result.data?.map((candidate) => candidate.entry.key)).toEqual(["FIN-001"]);
  });

  it("matches on display when the source has no keys", async () => {
    const keyless: ValueSetEntry[] = [{ display: "Finance" }, { display: "Legal" }];
    const model = stubModel(async () =>
      ok({ object: { choices: [{ key: "", display: "Legal" }] }, usage }),
    );

    const result = await new AiValueSetShortlister(model).shortlist({
      query: "litigation",
      entries: keyless,
      limit: 5,
    });

    expect(result.data?.map((candidate) => candidate.entry.display)).toEqual(["Legal"]);
  });

  it("returns the same entry only once however often the model names it", async () => {
    const model = stubModel(async () =>
      ok({ object: { choices: [choice("FIN-001"), choice("FIN-001")] }, usage }),
    );

    const result = await new AiValueSetShortlister(model).shortlist({
      query: "procurement",
      entries: departments,
      limit: 5,
    });

    expect(result.data).toHaveLength(1);
  });

  it("honours the caller's limit", async () => {
    const model = stubModel(async () =>
      ok({ object: { choices: [choice("CS-001"), choice("FIN-001"), choice("HR-001")] }, usage }),
    );

    const result = await new AiValueSetShortlister(model).shortlist({
      query: "procurement",
      entries: departments,
      limit: 2,
    });

    expect(result.data).toHaveLength(2);
  });

  it("degrades to no candidates when the model fails, rather than failing the lookup", async () => {
    const model = stubModel(async () => err(domainError("AI_PROVIDER_FAILED", "down")));

    const result = await new AiValueSetShortlister(model).shortlist({
      query: "procurement",
      entries: departments,
      limit: 5,
    });

    expect(result.error).toBeUndefined();
    expect(result.data).toEqual([]);
  });

  it("degrades to no candidates when the model returns something unusable", async () => {
    const model = stubModel(async () => ok({ object: { nonsense: true }, usage }));

    const result = await new AiValueSetShortlister(model).shortlist({
      query: "procurement",
      entries: departments,
      limit: 5,
    });

    expect(result.data).toEqual([]);
  });

  it("does not call the model at all for an empty set", async () => {
    const generate = vi.fn(async () => ok({ object: { choices: [] }, usage }));

    const result = await new AiValueSetShortlister(stubModel(generate)).shortlist({
      query: "procurement",
      entries: [],
      limit: 5,
    });

    expect(generate).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
  });

  it("puts the field label in the prompt when the caller knows it", async () => {
    const generate = vi.fn(async () => ok({ object: { choices: [] }, usage }));

    await new AiValueSetShortlister(stubModel(generate)).shortlist({
      query: "procurement",
      entries: departments,
      fieldLabel: "Department",
      limit: 5,
    });

    expect(generate.mock.calls[0]?.[0]?.prompt).toContain("Department");
  });

  it("sends the entries so the model chooses from the set rather than from memory", async () => {
    const generate = vi.fn(async () => ok({ object: { choices: [] }, usage }));

    await new AiValueSetShortlister(stubModel(generate)).shortlist({
      query: "procurement",
      entries: departments,
      limit: 5,
    });

    const prompt = generate.mock.calls[0]?.[0]?.prompt ?? "";
    expect(prompt).toContain("Corporate Services");
    expect(prompt).toContain("CS-001");
  });
});

describe("sampleForShortlist", () => {
  const wide = (count: number): ValueSetEntry[] =>
    Array.from({ length: count }, (_, index) => ({
      display: `Team ${index}`,
      key: `T-${index}`,
    }));

  it("sends a set that fits under the budget untouched", () => {
    const entries = wide(50);

    expect(sampleForShortlist(entries, "team 3", 100)).toEqual(entries);
  });

  it("never returns more than the budget", () => {
    expect(sampleForShortlist(wide(5_000), "team 3", 100)).toHaveLength(100);
  });

  it("keeps the best string matches, which are the likeliest answers", () => {
    const sampled = sampleForShortlist(wide(5_000), "Team 4242", 50);

    expect(sampled.map((entry) => entry.key)).toContain("T-4242");
  });

  it("spans the whole set rather than sending only its head", () => {
    const sampled = sampleForShortlist(wide(5_000), "Team 7", 50);
    const indexes = sampled.map((entry) => Number(entry.key!.replace("T-", "")));

    expect(Math.max(...indexes)).toBeGreaterThan(4_000);
  });

  it("returns each entry once", () => {
    const sampled = sampleForShortlist(wide(5_000), "Team 12", 60);

    expect(new Set(sampled.map((entry) => entry.key)).size).toBe(sampled.length);
  });

  it("publishes a budget large enough for an ordinary reference list", () => {
    expect(SHORTLIST_ENTRY_BUDGET).toBe(1_500);
  });
});
