import { describe, expect, it } from "vitest";
import {
  CLASSIFICATION_OPTIONS,
  classificationBadge,
  credentialSummary,
  formatHeaderNames,
  parseCustomHeaders,
  parseStatusMeanings,
  secondsToTimeoutMs,
  timeoutMsToSeconds,
  toolSettingsFromForm,
  toolSettingsToForm,
} from "./mcp-server-form-model";

describe("classification copy", () => {
  it("offers the three classifications with an explanation each", () => {
    expect(CLASSIFICATION_OPTIONS.map((option) => option.value)).toEqual(["internal", "public-read", "external-write"]);
    for (const option of CLASSIFICATION_OPTIONS) expect(option.description.length).toBeGreaterThan(20);
  });

  it("says which classifications flows can use", () => {
    expect(classificationBadge("internal")).toEqual({ label: "Internal", usableInFlows: true });
    expect(classificationBadge("public-read")).toEqual({ label: "Public data", usableInFlows: true });
    expect(classificationBadge("external-write")).toEqual({ label: "Sends records out", usableInFlows: false });
  });
});

describe("timeout", () => {
  it("converts between the seconds an admin types and stored milliseconds", () => {
    expect(secondsToTimeoutMs("45")).toBe(45_000);
    expect(timeoutMsToSeconds(30_000)).toBe("30");
  });

  it("reads a blank or non-numeric entry as no value", () => {
    expect(secondsToTimeoutMs(" ")).toBeUndefined();
    expect(secondsToTimeoutMs("soon")).toBeUndefined();
  });
});

describe("parseCustomHeaders", () => {
  it("reads one Name: value header per line", () => {
    expect(parseCustomHeaders("X-Api-Key: abc\n\nX-Tenant:  gov:uk ")).toEqual({
      headers: { "X-Api-Key": "abc", "X-Tenant": "gov:uk" },
      error: null,
    });
  });

  it("reports a line with no colon", () => {
    expect(parseCustomHeaders("X-Api-Key abc").error).toContain("X-Api-Key abc");
  });

  it("reads empty text as no headers", () => {
    expect(parseCustomHeaders("  ")).toEqual({ headers: {}, error: null });
  });
});

describe("credential summary", () => {
  it("names what is saved without any value", () => {
    expect(credentialSummary({ hasCredential: true, customHeaderNames: ["X-Api-Key"] })).toBe(
      "Token saved · headers: X-Api-Key",
    );
    expect(credentialSummary({ hasCredential: false, customHeaderNames: [] })).toBe("—");
    expect(formatHeaderNames(["A", "B"])).toBe("A, B");
  });
});

describe("parseStatusMeanings", () => {
  it("reads value = meaning lines", () => {
    expect(parseStatusMeanings("no_data = no-data\nsource_unavailable=source-unavailable")).toEqual({
      meanings: { no_data: "no-data", source_unavailable: "source-unavailable" },
      error: null,
    });
  });

  it("reports an unknown meaning", () => {
    expect(parseStatusMeanings("down = broken").error).toContain("broken");
  });
});

describe("tool settings form", () => {
  const settings = {
    pagination: { cursorArgument: "cursor", nextCursorPath: "next_cursor", itemsPath: "items", maxPages: 3 },
    status: { statusPath: "status", meanings: { no_data: "no-data" as const }, caveatsPath: "caveats" },
    citation: { recordsPath: "items", locatorField: "id", titleField: "title", urlField: "url", timestampField: null },
  };

  it("round-trips settings through the form", () => {
    expect(toolSettingsFromForm(toolSettingsToForm(settings))).toEqual({ settings, error: null });
  });

  it("turns a section off when its required field is blank", () => {
    const form = { ...toolSettingsToForm(settings), cursorArgument: "", statusPath: "", recordsPath: "" };

    expect(toolSettingsFromForm(form)).toEqual({
      settings: { pagination: null, status: null, citation: null },
      error: null,
    });
  });

  it("reports a page limit that is not a whole number", () => {
    expect(toolSettingsFromForm({ ...toolSettingsToForm(settings), maxPages: "lots" }).error).toContain("page limit");
  });
});
