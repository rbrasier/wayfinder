import { describe, expect, it } from "vitest";
import { CONNECTIVITY_TARGETS } from "./connectivity";

describe("CONNECTIVITY_TARGETS", () => {
  it("lists every external-dependency target with no duplicates", () => {
    expect(CONNECTIVITY_TARGETS).toEqual([
      "ai",
      "storage",
      "email",
      "n8n",
      "embeddings",
      "entra",
      "auth-entra",
      "auth-pki",
      "auth-email-password",
      "pdf-converter",
      "signature-engine",
      "timestamp-authority",
      "signing-provider",
    ]);
    expect(new Set(CONNECTIVITY_TARGETS).size).toBe(CONNECTIVITY_TARGETS.length);
  });

  // auth-entra answers "can a user sign in?"; entra answers "does the Graph
  // directory permission work?". Collapsing them would gate setup on
  // User.Read.All, which sign-in never uses (ADR-042 §5).
  it("keeps the Graph directory target distinct from the sign-in target", () => {
    expect(CONNECTIVITY_TARGETS).toContain("entra");
    expect(CONNECTIVITY_TARGETS).toContain("auth-entra");
  });
});
