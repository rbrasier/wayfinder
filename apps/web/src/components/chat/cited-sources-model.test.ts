import { describe, expect, it } from "vitest";
import { citedSourceRows } from "./cited-sources-model";

const source = (marker: string, overrides = {}) => ({
  marker,
  serverId: "mcp-1",
  serverLabel: "Legislation",
  toolName: "search",
  locator: `act-${marker}`,
  title: `Act ${marker}`,
  url: `https://legislation.example/${marker}`,
  recordedAt: "2026-01-02",
  ...overrides,
});

describe("citedSourceRows", () => {
  it("lists each cited record by its marker, linked when it has a URL", () => {
    expect(citedSourceRows([source("S2"), source("S1", { url: null, title: null, recordedAt: null })])).toEqual([
      { marker: "S2", title: "Act S2", href: "https://legislation.example/S2", detail: "Legislation · act-S2 · 2026-01-02" },
      { marker: "S1", title: "act-S1", href: null, detail: "Legislation" },
    ]);
  });

  it("returns nothing for a turn that cited no records", () => {
    expect(citedSourceRows(undefined)).toEqual([]);
  });
});
