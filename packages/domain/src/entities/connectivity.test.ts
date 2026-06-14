import { describe, expect, it } from "vitest";
import { CONNECTIVITY_TARGETS } from "./connectivity";

describe("CONNECTIVITY_TARGETS", () => {
  it("lists the six external-dependency targets with no duplicates", () => {
    expect(CONNECTIVITY_TARGETS).toEqual(["ai", "storage", "email", "n8n", "embeddings", "entra"]);
    expect(new Set(CONNECTIVITY_TARGETS).size).toBe(CONNECTIVITY_TARGETS.length);
  });
});
