import { describe, expect, it } from "vitest";
import {
  localToday,
  MAX_EVIDENCE_BYTES,
  offSystemFormError,
  toBase64,
} from "./off-system-approval-form";

const today = "2026-08-20";

const state = (overrides: Partial<Parameters<typeof offSystemFormError>[0]> = {}) => ({
  filename: "signed-memo.pdf",
  sizeBytes: 48213,
  approvedOn: "2026-08-14",
  ...overrides,
});

describe("offSystemFormError", () => {
  it("lets a complete form through", () => {
    expect(offSystemFormError(state(), today)).toBeNull();
  });

  it("accepts today", () => {
    expect(offSystemFormError(state({ approvedOn: today }), today)).toBeNull();
  });

  it("asks for the evidence when no file has been chosen", () => {
    expect(offSystemFormError(state({ filename: null }), today)).toBe(
      "Attach the evidence that this approval happened.",
    );
  });

  it("asks for the date when only a file has been chosen", () => {
    expect(offSystemFormError(state({ approvedOn: "" }), today)).toBe(
      "Confirm the date the approval happened.",
    );
  });

  it("refuses a date in the future", () => {
    expect(offSystemFormError(state({ approvedOn: "2026-08-21" }), today)).toBe(
      "The approval date cannot be in the future.",
    );
  });

  it("refuses an empty file", () => {
    expect(offSystemFormError(state({ sizeBytes: 0 }), today)).toBe("That file is empty.");
  });

  it("refuses a file past the size ceiling", () => {
    expect(offSystemFormError(state({ sizeBytes: MAX_EVIDENCE_BYTES + 1 }), today)).toBe(
      "That file is larger than 10 MB.",
    );
  });

  it("names the missing evidence first when both are missing", () => {
    // Evidence is the harder thing to produce, so it is the one to ask for.
    expect(offSystemFormError(state({ filename: null, approvedOn: "" }), today)).toBe(
      "Attach the evidence that this approval happened.",
    );
  });
});

describe("localToday", () => {
  it("reports the viewer's own day, not the server's", () => {
    // Late on the 20th in a zone ahead of UTC is still the 20th to the person
    // looking at it; a UTC "today" would refuse their morning's approval.
    expect(localToday(new Date(2026, 7, 20, 23, 30))).toBe("2026-08-20");
  });

  it("pads single-digit months and days", () => {
    expect(localToday(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("toBase64", () => {
  it("round-trips through the decoding the server does", () => {
    const bytes = new TextEncoder().encode("a scan of the signed memo");

    expect(Buffer.from(toBase64(bytes), "base64").toString("utf8")).toBe(
      "a scan of the signed memo",
    );
  });

  it("survives a payload past the chunking boundary", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17).fill(7);

    const decoded = Buffer.from(toBase64(bytes), "base64");
    expect(decoded.byteLength).toBe(bytes.length);
    expect(decoded[decoded.byteLength - 1]).toBe(7);
  });
});
