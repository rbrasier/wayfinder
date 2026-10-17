import { describe, expect, it } from "vitest";
import { splitDocumentText } from "./split-document-text";

describe("splitDocumentText", () => {
  it("leaves a text that already fits as one segment", () => {
    expect(splitDocumentText("short text", 100)).toEqual(["short text"]);
  });

  it("splits on paragraph boundaries, keeping every segment within the limit", () => {
    const paragraphs = Array.from({ length: 10 }, (_, index) => `Paragraph ${index} `.repeat(5).trim());
    const text = paragraphs.join("\n\n");

    const segments = splitDocumentText(text, 200);

    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) expect(segment.length).toBeLessThanOrEqual(200);
    // No paragraph is cut when whole paragraphs fit.
    for (const paragraph of paragraphs) {
      expect(segments.some((segment) => segment.includes(paragraph))).toBe(true);
    }
  });

  it("falls back to lines for a paragraph larger than the limit", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index} of the feed`);
    const segments = splitDocumentText(lines.join("\n"), 80);

    for (const segment of segments) expect(segment.length).toBeLessThanOrEqual(80);
    for (const line of lines) {
      expect(segments.some((segment) => segment.includes(line))).toBe(true);
    }
  });

  it("hard-cuts an unbroken run longer than the limit, losing no characters", () => {
    const text = "x".repeat(250);

    const segments = splitDocumentText(text, 100);

    expect(segments.map((segment) => segment.length)).toEqual([100, 100, 50]);
    expect(segments.join("")).toBe(text);
  });
});
