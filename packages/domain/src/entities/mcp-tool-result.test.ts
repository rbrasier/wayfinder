import { describe, expect, it } from "vitest";
import {
  applyStatusMapping,
  extractCitations,
  isValidResultPath,
  mergePageItems,
  readPath,
  sanitizeCitationUrl,
  validateMcpToolSettings,
} from "./mcp-tool-result";

const origin = { serverId: "server-1", serverLabel: "Legislation", toolName: "search_legislation" };

describe("readPath", () => {
  const value = { result: { items: [{ id: "a" }, { id: "b" }], meta: { status: "ok" } } };

  it("reads nested object members and array indexes", () => {
    expect(readPath(value, "result.meta.status")).toBe("ok");
    expect(readPath(value, "result.items.1.id")).toBe("b");
  });

  it("returns undefined for a missing member or a non-object", () => {
    expect(readPath(value, "result.missing.deep")).toBeUndefined();
    expect(readPath("text", "anything")).toBeUndefined();
  });
});

describe("isValidResultPath", () => {
  it("accepts dotted identifiers with numeric segments", () => {
    expect(isValidResultPath("next_cursor")).toBe(true);
    expect(isValidResultPath("data.items.0.id")).toBe(true);
  });

  it("rejects empty paths, leading dots and expression characters", () => {
    expect(isValidResultPath("")).toBe(false);
    expect(isValidResultPath(".items")).toBe(false);
    expect(isValidResultPath("items[0]")).toBe(false);
  });
});

describe("applyStatusMapping", () => {
  const mapping = {
    statusPath: "status",
    meanings: {
      no_data: "no-data",
      source_unavailable: "source-unavailable",
      partial: "upstream-gap",
    } as const,
    caveatsPath: "caveats",
  };

  it("maps each configured value to its kind and confidence", () => {
    expect(applyStatusMapping({ status: "no_data" }, mapping)).toMatchObject({
      kind: "no-data",
      confidence: 1,
    });
    expect(applyStatusMapping({ status: "source_unavailable" }, mapping)).toMatchObject({
      kind: "source-unavailable",
      confidence: 0,
    });
    expect(applyStatusMapping({ status: "partial" }, mapping)).toMatchObject({
      kind: "upstream-gap",
      confidence: 0.5,
    });
  });

  it("reads a value the admin did not map as ok, keeping the raw value", () => {
    expect(applyStatusMapping({ status: "success" }, mapping)).toEqual({
      kind: "ok",
      raw: "success",
      caveats: [],
      confidence: 1,
    });
  });

  it("collects caveats from a list or a single string", () => {
    expect(
      applyStatusMapping({ status: "ok", caveats: ["Provisional", 3, "Unofficial"] }, mapping)?.caveats,
    ).toEqual(["Provisional", "Unofficial"]);
    expect(applyStatusMapping({ status: "ok", caveats: "Unofficial copy" }, mapping)?.caveats).toEqual([
      "Unofficial copy",
    ]);
  });

  it("returns null when the result carries no status at the path", () => {
    expect(applyStatusMapping({ items: [] }, mapping)).toBeNull();
  });
});

describe("sanitizeCitationUrl", () => {
  it("keeps http and https URLs", () => {
    expect(sanitizeCitationUrl("https://legislation.example/act/1")).toBe(
      "https://legislation.example/act/1",
    );
  });

  it("drops other schemes and non-URLs", () => {
    expect(sanitizeCitationUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeCitationUrl("file:///etc/passwd")).toBeNull();
    expect(sanitizeCitationUrl("not a url")).toBeNull();
    expect(sanitizeCitationUrl(42)).toBeNull();
  });
});

describe("extractCitations", () => {
  const mapping = {
    recordsPath: "items",
    locatorField: "id",
    titleField: "title",
    urlField: "url",
    timestampField: "published_at",
  };

  it("builds one citation per record with a locator", () => {
    const citations = extractCitations({
      structured: {
        items: [
          { id: "act-1", title: "Water Act", url: "https://x.example/1", published_at: "2026-01-02" },
          { id: "act-2", title: "Fire Act", url: "javascript:void 0" },
          { title: "No locator" },
        ],
      },
      mapping,
      resourceLinks: [],
      origin,
    });

    expect(citations).toEqual([
      { ...origin, locator: "act-1", title: "Water Act", url: "https://x.example/1", recordedAt: "2026-01-02" },
      { ...origin, locator: "act-2", title: "Fire Act", url: null, recordedAt: null },
    ]);
  });

  it("turns resource links into citations without configuration", () => {
    const citations = extractCitations({
      structured: null,
      mapping: null,
      resourceLinks: [{ uri: "https://stats.example/r/9", name: "release-9", title: "June release" }],
      origin,
    });

    expect(citations).toEqual([
      { ...origin, locator: "https://stats.example/r/9", title: "June release", url: "https://stats.example/r/9", recordedAt: null },
    ]);
  });

  it("drops duplicate locators", () => {
    const citations = extractCitations({
      structured: { items: [{ id: "same" }, { id: "same" }] },
      mapping,
      resourceLinks: [],
      origin,
    });

    expect(citations).toHaveLength(1);
  });
});

describe("mergePageItems", () => {
  it("concatenates the items array across pages into the first page's shape", () => {
    const merged = mergePageItems(
      [
        { status: "ok", items: [1, 2], next_cursor: "p2" },
        { status: "ok", items: [3], next_cursor: null },
      ],
      "items",
    );

    expect(merged).toEqual({ status: "ok", items: [1, 2, 3], next_cursor: "p2" });
  });

  it("supports a nested items path and ignores pages without an array there", () => {
    const merged = mergePageItems([{ data: { items: ["a"] } }, { data: {} }, { data: { items: ["b"] } }], "data.items");

    expect(merged).toEqual({ data: { items: ["a", "b"] } });
  });

  it("returns the first page unchanged when it has no array at the path", () => {
    expect(mergePageItems([{ text: "x" }, { items: [1] }], "items")).toEqual({ text: "x" });
  });
});

describe("validateMcpToolSettings", () => {
  it("accepts complete settings and empty settings", () => {
    expect(validateMcpToolSettings({ pagination: null, status: null, citation: null }).data).toBeDefined();
    expect(
      validateMcpToolSettings({
        pagination: { cursorArgument: "cursor", nextCursorPath: "next_cursor", itemsPath: "items", maxPages: 5 },
        status: { statusPath: "status", meanings: { down: "source-unavailable" }, caveatsPath: null },
        citation: { recordsPath: "items", locatorField: "id", titleField: null, urlField: "url", timestampField: null },
      }).data,
    ).toBeDefined();
  });

  it("rejects a page limit outside 1–20", () => {
    const result = validateMcpToolSettings({
      pagination: { cursorArgument: "cursor", nextCursorPath: "next", itemsPath: "items", maxPages: 21 },
      status: null,
      citation: null,
    });
    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a malformed path, an empty cursor argument, or no status meanings", () => {
    expect(
      validateMcpToolSettings({
        pagination: { cursorArgument: "", nextCursorPath: "next", itemsPath: "items", maxPages: 2 },
        status: null,
        citation: null,
      }).error,
    ).toBeDefined();
    expect(
      validateMcpToolSettings({
        pagination: null,
        status: { statusPath: "status", meanings: {}, caveatsPath: null },
        citation: null,
      }).error,
    ).toBeDefined();
    expect(
      validateMcpToolSettings({
        pagination: null,
        status: null,
        citation: { recordsPath: "items[0]", locatorField: "id", titleField: null, urlField: null, timestampField: null },
      }).error,
    ).toBeDefined();
  });
});
