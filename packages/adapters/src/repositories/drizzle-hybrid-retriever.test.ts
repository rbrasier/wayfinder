import { describe, expect, it } from "vitest";
import { buildExactLikePattern } from "./drizzle-hybrid-retriever";

describe("buildExactLikePattern", () => {
  it("wraps a plain term in match-anywhere wildcards unchanged", () => {
    expect(buildExactLikePattern("hello")).toBe("%hello%");
  });

  it("strips author-typed wrapping quotes before matching", () => {
    expect(buildExactLikePattern('"INV-2024-001"')).toBe("%INV-2024-001%");
  });

  it("escapes a literal percent so it is not a LIKE wildcard", () => {
    expect(buildExactLikePattern("100%")).toBe("%100\\%%");
  });

  it("escapes a literal underscore so it does not match any character", () => {
    expect(buildExactLikePattern("ITEM_42")).toBe("%ITEM\\_42%");
  });

  it("escapes a literal backslash", () => {
    expect(buildExactLikePattern("a\\b")).toBe("%a\\\\b%");
  });
});
