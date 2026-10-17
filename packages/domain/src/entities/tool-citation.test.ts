import { describe, expect, it } from "vitest";
import { numberCitations, resolveCitedSources, type ToolRecordCitation } from "./tool-citation";

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
