import { describe, expect, it } from "vitest";
import {
  classifyValueSetMatch,
  matchTokens,
  mergeCandidates,
  NEAR_CERTAIN_MARGIN,
  NEAR_CERTAIN_SCORE,
  normaliseForMatch,
  rankValueSetCandidates,
  tokenSimilarity,
  trigramSimilarity,
  type MatchTier,
  type ValueSetCandidate,
} from "./value-set-matching";
import type { ValueSetEntry } from "./lookup-source";

const entries: ValueSetEntry[] = [
  { display: "Finance", key: "FIN-001" },
  { display: "Finance & Procurement", key: "FIN-002" },
  { display: "Human Resources", key: "HR-001" },
  { display: "Corporate Services", key: "CS-001" },
  { display: "Field Operations", key: "OPS-001" },
];

describe("normaliseForMatch", () => {
  it("lowercases, strips punctuation and collapses whitespace", () => {
    expect(normaliseForMatch("  Finance &  Procurement! ")).toBe("finance procurement");
  });

  it("strips diacritics so an accented spelling matches a plain one", () => {
    expect(normaliseForMatch("Bureau de Contrôle")).toBe(normaliseForMatch("Bureau de Controle"));
  });

  it("returns an empty string for a value with nothing matchable in it", () => {
    expect(normaliseForMatch("  --  ")).toBe("");
  });
});

describe("matchTokens", () => {
  it("drops the joining words that carry no meaning", () => {
    expect(matchTokens("Department of the Interior")).toEqual(["department", "interior"]);
  });

  it("folds a plural onto its singular so 'services' meets 'service'", () => {
    expect(matchTokens("Corporate Services")).toEqual(matchTokens("Corporate Service"));
  });

  it("leaves a short word ending in s alone", () => {
    expect(matchTokens("Ops")).toEqual(["ops"]);
  });
});

describe("tokenSimilarity", () => {
  it("scores an identical token set as one", () => {
    expect(tokenSimilarity("Corporate Services", "corporate service")).toBe(1);
  });

  it("scores a partial overlap between zero and one", () => {
    const score = tokenSimilarity("Finance and Procurement", "Procurement");

    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("scores unrelated phrases as zero", () => {
    expect(tokenSimilarity("Finance", "Legal")).toBe(0);
  });

  it("credits a prefix of a longer word", () => {
    expect(tokenSimilarity("Admin", "Administration")).toBeGreaterThan(0);
  });

  it("does not credit a two-letter prefix, which would match almost anything", () => {
    expect(tokenSimilarity("Op", "Operations")).toBe(0);
  });
});

describe("trigramSimilarity", () => {
  it("scores identical strings as one", () => {
    expect(trigramSimilarity("finance", "Finance")).toBe(1);
  });

  it("scores a typo close to one", () => {
    expect(trigramSimilarity("Finence", "Finance")).toBeGreaterThan(0.5);
  });

  it("scores unrelated strings low", () => {
    expect(trigramSimilarity("Finance", "Legal")).toBeLessThan(0.2);
  });
});

describe("rankValueSetCandidates", () => {
  it("returns the exact display match alone, ignoring weaker neighbours", () => {
    const candidates = rankValueSetCandidates(entries, "finance");

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.entry.key).toBe("FIN-001");
    expect(candidates[0]!.tier).toBe("exact");
  });

  it("matches on the key as well as the display", () => {
    const candidates = rankValueSetCandidates(entries, "HR-001");

    expect(candidates[0]!.entry.display).toBe("Human Resources");
    expect(candidates[0]!.tier).toBe("exact");
  });

  it("treats a punctuation and case variant as a normalised match", () => {
    const candidates = rankValueSetCandidates(entries, "finance and procurement");

    expect(candidates[0]!.entry.key).toBe("FIN-002");
    expect(candidates[0]!.tier).toBe("normalised");
  });

  it("offers the related entry when a word overlaps but nothing matches outright", () => {
    const candidates = rankValueSetCandidates(entries, "procurement");

    expect(candidates[0]!.entry.key).toBe("FIN-002");
    expect(candidates[0]!.tier).toBe("token");
    expect(candidates[0]!.score).toBeLessThan(1);
  });

  it("recovers from a typo", () => {
    const candidates = rankValueSetCandidates(entries, "Corprate Services");

    expect(candidates[0]!.entry.key).toBe("CS-001");
  });

  it("returns nothing for a value with no relationship to the set", () => {
    expect(rankValueSetCandidates(entries, "aardvark")).toEqual([]);
  });

  it("returns nothing for a blank query rather than the whole set", () => {
    expect(rankValueSetCandidates(entries, "   ")).toEqual([]);
  });

  it("caps the list so a caller cannot be handed the whole set", () => {
    const wide = Array.from({ length: 40 }, (_, index) => ({
      display: `Finance Team ${index}`,
      key: `T-${index}`,
    }));

    expect(rankValueSetCandidates(wide, "finance team").length).toBeLessThanOrEqual(5);
  });

  it("orders by score, then by display so the same input always ranks the same", () => {
    const scores = rankValueSetCandidates(entries, "operations service").map(
      (candidate) => candidate.score,
    );

    expect([...scores].sort((left, right) => right - left)).toEqual(scores);
  });
});

describe("classifyValueSetMatch", () => {
  const candidate = (
    display: string,
    tier: ValueSetCandidate["tier"],
    key?: string,
    score = 1,
  ): ValueSetCandidate => ({ entry: { display, ...(key ? { key } : {}) }, score, tier });

  it("resolves an exact match without asking anyone", () => {
    const outcome = classifyValueSetMatch([candidate("Finance", "exact", "FIN-001")]);

    expect(outcome.kind).toBe("resolved");
  });

  it("resolves a normalised match, which is the same value spelled differently", () => {
    expect(classifyValueSetMatch([candidate("Finance", "normalised", "FIN-001")]).kind).toBe(
      "resolved",
    );
  });

  it("asks when the best it can do is a related word", () => {
    // 0.5 is what "procurement" actually scores against "Finance & Procurement":
    // one of two words shared, which is a relation, not a spelling.
    const outcome = classifyValueSetMatch([
      candidate("Finance & Procurement", "token", "FIN-002", 0.5),
    ]);

    expect(outcome.kind).toBe("candidates");
  });

  it("asks when two entries share a display under different keys", () => {
    const outcome = classifyValueSetMatch([
      candidate("Operations", "exact", "OPS-1"),
      candidate("Operations", "exact", "OPS-2"),
    ]);

    expect(outcome.kind).toBe("candidates");
  });

  it("resolves when the same entry is listed twice under one key", () => {
    const outcome = classifyValueSetMatch([
      candidate("Operations", "exact", "OPS-1"),
      candidate("Operations", "exact", "OPS-1"),
    ]);

    expect(outcome.kind).toBe("resolved");
  });

  it("reports nothing found for an empty candidate list", () => {
    expect(classifyValueSetMatch([]).kind).toBe("none");
  });
});

describe("classifyValueSetMatch — the near-certain rule", () => {
  // The scores here are the ones rankValueSetCandidates actually produces for
  // these inputs, so the thresholds are pinned to real arithmetic rather than to
  // numbers chosen to make the test pass.
  const scored = (display: string, score: number, tier: MatchTier = "token"): ValueSetCandidate => ({
    entry: { display },
    score,
    tier,
  });

  it("resolves a single typo that names one entry and nothing else", () => {
    const outcome = classifyValueSetMatch([
      scored("Corporate Services", 0.872),
      scored("Corporate Security", 0.462, "fuzzy"),
    ]);

    expect(outcome.kind).toBe("resolved");
  });

  it("resolves a typo whose entry has no rival at all", () => {
    expect(classifyValueSetMatch([scored("Finance", 0.737, "fuzzy")]).kind).toBe("resolved");
  });

  it("refuses when a rival entry is within the margin", () => {
    const outcome = classifyValueSetMatch([
      scored("Cost Centre 1001", 0.857),
      scored("Cost Centre 1002", 0.857),
    ]);

    expect(outcome.kind).toBe("candidates");
  });

  it("keeps Region 1 and Region 2 apart rather than guessing between them", () => {
    const outcome = classifyValueSetMatch([scored("Region 1", 0.778), scored("Region 2", 0.778)]);

    expect(outcome.kind).toBe("candidates");
  });

  it("refuses a match too weak to be a spelling of anything", () => {
    expect(classifyValueSetMatch([scored("Region 1", 0.6)]).kind).toBe("candidates");
  });

  it("never resolves an inferred candidate, however confident the model was", () => {
    const outcome = classifyValueSetMatch([scored("Finance", 0.99, "inferred")]);

    expect(outcome.kind).toBe("candidates");
  });

  it("measures the margin against a different entry, not a duplicate of the best one", () => {
    const outcome = classifyValueSetMatch([
      { entry: { display: "Operations", key: "OPS-1" }, score: 0.86, tier: "token" },
      { entry: { display: "Operations", key: "OPS-1" }, score: 0.86, tier: "token" },
    ]);

    expect(outcome.kind).toBe("resolved");
  });

  it("holds the published thresholds, which are what make the rule safe", () => {
    expect(NEAR_CERTAIN_SCORE).toBe(0.72);
    expect(NEAR_CERTAIN_MARGIN).toBe(0.18);
  });
});

// The rule is only as good as the scores the ladder actually produces, so these
// run the whole pipeline over real strings rather than hand-fed numbers.
describe("the near-certain rule over real value sets", () => {
  const classify = (set: ValueSetEntry[], query: string) =>
    classifyValueSetMatch(rankValueSetCandidates(set, query));

  const departments: ValueSetEntry[] = [
    { display: "Corporate Services", key: "CS-001" },
    { display: "Corporate Security", key: "CS-002" },
    { display: "Field Operations", key: "OPS-001" },
    { display: "Finance", key: "FIN-001" },
  ];

  const costCentres: ValueSetEntry[] = [
    { display: "Cost Centre 1001" },
    { display: "Cost Centre 1002" },
    { display: "Cost Centre 2001" },
  ];

  it.each([
    ["Corprate Services", "Corporate Services"],
    ["Corporate Servcies", "Corporate Services"],
    ["Corporate Servcurity", "Corporate Security"],
    ["Feild Operations", "Field Operations"],
    ["Finanace", "Finance"],
  ])("corrects %s to %s without asking", (typed, expected) => {
    const outcome = classify(departments, typed);

    expect(outcome.kind).toBe("resolved");
    if (outcome.kind !== "resolved") return;
    expect(outcome.candidate.entry.display).toBe(expected);
  });

  it.each([
    ["Cost Centre 100", "a prefix of two entries at once"],
    ["Cost Centre", "the shared part of every entry"],
    ["Cost Center 1001", "a rival one digit away"],
  ])("refuses to guess %s — %s", (typed) => {
    expect(classify(costCentres, typed).kind).toBe("candidates");
  });

  it("still shortlists a genuine leap in meaning rather than resolving it", () => {
    const outcome = classify(departments, "procurement");

    expect(outcome.kind).not.toBe("resolved");
  });

  it("leaves a value with no relationship to the set unmatched", () => {
    expect(classify(departments, "aardvark").kind).toBe("none");
  });
});

describe("mergeCandidates", () => {
  const stringCandidate: ValueSetCandidate = {
    entry: { display: "Finance", key: "FIN-001" },
    score: 0.6,
    tier: "token",
  };

  it("keeps the stronger score when both ladders found the same entry", () => {
    const merged = mergeCandidates(
      [stringCandidate],
      [{ entry: { display: "Finance", key: "FIN-001" }, score: 0.9, tier: "inferred" }],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]!.score).toBe(0.9);
    expect(merged[0]!.tier).toBe("inferred");
  });

  it("adds an entry only the inferred ladder found", () => {
    const merged = mergeCandidates(
      [stringCandidate],
      [{ entry: { display: "Legal", key: "LEG-1" }, score: 0.8, tier: "inferred" }],
    );

    expect(merged.map((candidate) => candidate.entry.display)).toEqual(["Legal", "Finance"]);
  });

  it("tells two entries apart when they share a display under different keys", () => {
    const merged = mergeCandidates(
      [{ entry: { display: "Operations", key: "OPS-1" }, score: 0.7, tier: "token" }],
      [{ entry: { display: "Operations", key: "OPS-2" }, score: 0.6, tier: "inferred" }],
    );

    expect(merged).toHaveLength(2);
  });

  it("caps the merged list", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({
      entry: { display: `Team ${index}` },
      score: 0.5,
      tier: "inferred" as const,
    }));

    expect(mergeCandidates([stringCandidate], many)).toHaveLength(5);
  });
});
