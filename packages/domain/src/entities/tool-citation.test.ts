import { describe, expect, it } from "vitest";
import { citationsForValue, numberCitations, resolveCitedSources, type ToolRecordCitation } from "./tool-citation";

const citation = (locator: string, toolName = "search"): ToolRecordCitation => ({
  serverId: "server-1",
  serverLabel: "Legislation",
  toolName,
  locator,
  title: `Record ${locator}`,
  url: null,
  recordedAt: null,
});

describe("numberCitations", () => {
  it("numbers citations S1…Sn in order", () => {
    const numbered = numberCitations([citation("a"), citation("b")]);

    expect(numbered.map((entry) => entry.marker)).toEqual(["S1", "S2"]);
    expect(numbered[1]!.citation.locator).toBe("b");
  });

  it("gives a record cited by two calls one number", () => {
    const numbered = numberCitations([citation("a"), citation("b"), citation("a")]);

    expect(numbered.map((entry) => entry.citation.locator)).toEqual(["a", "b"]);
  });

  it("keeps the same locator from different tools apart", () => {
    expect(numberCitations([citation("a", "one"), citation("a", "two")])).toHaveLength(2);
  });
});

describe("resolveCitedSources", () => {
  const numbered = numberCitations([citation("a"), citation("b"), citation("c")]);

  it("returns the cited records in the order the reply first cites them", () => {
    const cited = resolveCitedSources("The Act [S3] amends the earlier one [S1], see also [S3].", numbered);

    expect(cited.map((entry) => entry.marker)).toEqual(["S3", "S1"]);
    expect(cited[0]).toMatchObject({ marker: "S3", locator: "c" });
  });

  it("ignores markers that name no record", () => {
    expect(resolveCitedSources("Nothing at [S9] or [s1].", numbered)).toEqual([]);
  });
});

describe("citationsForValue", () => {
  const water = { ...citation("act-1"), title: "Water Act", url: "https://legislation.example/act-1" };
  const fire = { ...citation("act-2"), title: "Fire Act", url: "https://legislation.example/act-2" };
  const roads = { ...citation("act-3"), title: null, url: null };

  it("keeps only the records the value mentions, by locator, URL or title", () => {
    expect(citationsForValue('{"id":"act-1"}', [water, fire, roads])).toEqual([water]);
    expect(citationsForValue("See https://legislation.example/act-2", [water, fire])).toEqual([fire]);
    expect(citationsForValue("Governed by the water act.", [water, fire])).toEqual([water]);
  });

  it("does not mistake one locator for the start of a longer one", () => {
    const tenth = { ...citation("act-1"), title: null, url: null };

    expect(citationsForValue('{"id":"act-12"}', [tenth])).toEqual([]);
  });

  it("cites nothing for a blank value or one that mentions no record", () => {
    expect(citationsForValue("   ", [water, fire])).toEqual([]);
    expect(citationsForValue("12 results", [water, fire, roads])).toEqual([]);
  });
});
