import { describe, it, expect } from "vitest";
import { chunkText } from "./text-chunker";

describe("chunkText", () => {
  it("returns an empty array for blank input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("returns a single chunk for short text", () => {
    const chunks = chunkText("A short paragraph that fits in one chunk.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("A short paragraph that fits in one chunk.");
  });

  it("keeps paragraph boundaries together when they fit within the target size", () => {
    const first = "First paragraph.";
    const second = "Second paragraph.";
    const chunks = chunkText(`${first}\n\n${second}`, { targetTokens: 500 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toContain(first);
    expect(chunks[0]).toContain(second);
  });

  it("splits into multiple chunks when text exceeds the target size", () => {
    const paragraph = "word ".repeat(400).trim();
    const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const chunks = chunkText(text, { targetTokens: 200, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("splits an oversized single paragraph on sentence boundaries", () => {
    const sentence = "This is a sentence that carries some weight. ";
    const text = sentence.repeat(200).trim();
    const chunks = chunkText(text, { targetTokens: 100, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.trim().length).toBeGreaterThan(0);
    }
  });

  it("never produces a chunk that exceeds the character budget by more than one unit", () => {
    const paragraph = "alpha beta gamma delta ".repeat(100).trim();
    const text = `${paragraph}\n\n${paragraph}`;
    const targetTokens = 100;
    const chunks = chunkText(text, { targetTokens, overlapTokens: 10 });
    const charBudget = targetTokens * 4;
    for (const chunk of chunks) {
      // Sentence/paragraph units may overshoot slightly, but a runaway chunk
      // (e.g. the whole document) would indicate the splitter failed.
      expect(chunk.length).toBeLessThanOrEqual(charBudget * 2);
    }
  });

  it("overlaps adjacent chunks so boundary-spanning context is preserved", () => {
    const paragraphs = Array.from({ length: 6 }, (_, index) => `Paragraph number ${index} with enough words to matter here.`);
    const text = paragraphs.join("\n\n");
    const chunks = chunkText(text, { targetTokens: 30, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    // The tail of one chunk should reappear at the head of the next.
    const firstTailWord = chunks[0].trim().split(/\s+/).at(-1);
    expect(chunks[1]).toContain(firstTailWord);
  });

  it("strips {{ placeholder }} tags when stripPlaceholders is set", () => {
    const text = "Dear {{ client_name }}, your order {{order_id}} is ready.";
    const chunks = chunkText(text, { stripPlaceholders: true });
    expect(chunks.join("\n")).not.toContain("{{");
    expect(chunks.join("\n")).not.toContain("}}");
    expect(chunks.join("\n")).not.toContain("client_name");
    expect(chunks.join("\n")).toContain("your order");
  });

  it("does not strip placeholders by default", () => {
    const chunks = chunkText("Hello {{ name }}");
    expect(chunks[0]).toContain("{{ name }}");
  });
});
