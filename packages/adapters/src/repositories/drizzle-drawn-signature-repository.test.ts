import { describe, expect, it } from "vitest";
import { drawnSignatureFromColumns } from "./drizzle-drawn-signature-repository";

describe("drawnSignatureFromColumns", () => {
  it("maps a user who has drawn a signature", () => {
    const updatedAt = new Date("2026-11-08T10:00:00Z");

    expect(
      drawnSignatureFromColumns("user-1", {
        drawn_signature_storage_path: "signatures/drawn/user-1/1.png",
        drawn_signature_updated_at: updatedAt,
      }),
    ).toEqual({ userId: "user-1", storagePath: "signatures/drawn/user-1/1.png", updatedAt });
  });

  it("maps a user who has never drawn one to null", () => {
    expect(
      drawnSignatureFromColumns("user-1", { drawn_signature_storage_path: null, drawn_signature_updated_at: null }),
    ).toBeNull();
  });
});
