import { describe, expect, it } from "vitest";
import {
  emptyPagingDraft,
  pagingFromConfig,
  pagingToConfig,
  type LookupSourcePagingDraft,
} from "./lookup-source-paging";

const draft = (overrides: Partial<LookupSourcePagingDraft> = {}): LookupSourcePagingDraft => ({
  ...emptyPagingDraft(),
  style: "offset",
  param: "offset",
  sizeParam: "limit",
  size: "200",
  ...overrides,
});

describe("pagingToConfig", () => {
  it("writes nothing for a source that serves its whole set in one response", () => {
    expect(pagingToConfig(emptyPagingDraft())).toEqual({});
  });

  it("writes nothing when a style is chosen but the parameter is not named", () => {
    expect(pagingToConfig(draft({ param: "  " }))).toEqual({});
  });

  it("writes the offset shape", () => {
    expect(pagingToConfig(draft())).toEqual({
      paging: { style: "offset", param: "offset", sizeParam: "limit", size: 200 },
    });
  });

  it("keeps the cursor path only for a cursor source", () => {
    const cursor = pagingToConfig(draft({ style: "cursor", param: "cursor", cursorPath: "meta.next" }));
    const offset = pagingToConfig(draft({ cursorPath: "meta.next" }));

    expect((cursor.paging as Record<string, unknown>).cursorPath).toBe("meta.next");
    expect((offset.paging as Record<string, unknown>).cursorPath).toBeUndefined();
  });

  it("keeps a first page of zero, which is a real setting rather than an unset one", () => {
    const config = pagingToConfig(draft({ style: "page", param: "page", startPage: "0" }));

    expect((config.paging as Record<string, unknown>).startPage).toBe(0);
  });

  it("drops a page size that is not a positive whole number", () => {
    expect((pagingToConfig(draft({ size: "0" })).paging as Record<string, unknown>).size).toBeUndefined();
    expect(
      (pagingToConfig(draft({ size: "two hundred" })).paging as Record<string, unknown>).size,
    ).toBeUndefined();
  });

  it("carries the record ceiling alongside the paging block, not inside it", () => {
    const config = pagingToConfig(draft({ maxRecords: "1200" }));

    expect(config.maxRecords).toBe(1200);
    expect((config.paging as Record<string, unknown>).maxRecords).toBeUndefined();
  });
});

describe("pagingFromConfig", () => {
  it("reads a stored paging block back into the editor", () => {
    expect(
      pagingFromConfig({
        paging: { style: "cursor", param: "cursor", cursorPath: "meta.next", size: 100 },
        maxRecords: 2000,
      }),
    ).toEqual({
      style: "cursor",
      param: "cursor",
      sizeParam: "",
      size: "100",
      cursorPath: "meta.next",
      startPage: "",
      maxRecords: "2000",
    });
  });

  it("reads a source with no paging as one response", () => {
    expect(pagingFromConfig({ url: "https://x.example.gov" }).style).toBe("none");
  });

  it("keeps a ceiling that was set without paging", () => {
    expect(pagingFromConfig({ maxRecords: 300 }).maxRecords).toBe("300");
  });

  it("round-trips a draft through the config and back", () => {
    const original = draft({ maxRecords: "900" });

    expect(pagingFromConfig(pagingToConfig(original))).toEqual(original);
  });
});
