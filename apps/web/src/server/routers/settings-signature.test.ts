import { describe, expect, it } from "vitest";
import { signatureConfigInputSchema } from "./settings-signature";

describe("signatureConfigInputSchema", () => {
  it("accepts attestation with nothing else", () => {
    const parsed = signatureConfigInputSchema.safeParse({
      method: "attestation",
      gotenbergUrl: null,
      dssUrl: null,
      tsaUrl: null,
      csc: null,
    });

    expect(parsed.success).toBe(true);
  });

  it("turns blank urls into null", () => {
    const parsed = signatureConfigInputSchema.parse({
      method: "drawn",
      gotenbergUrl: "  ",
      dssUrl: "",
      tsaUrl: null,
      csc: null,
    });

    expect(parsed.gotenbergUrl).toBeNull();
    expect(parsed.dssUrl).toBeNull();
  });

  it("rejects an unknown method", () => {
    const parsed = signatureConfigInputSchema.safeParse({
      method: "qualified",
      gotenbergUrl: null,
      dssUrl: null,
      tsaUrl: null,
      csc: null,
    });

    expect(parsed.success).toBe(false);
  });

  it("allows a blank client secret so the stored one is kept", () => {
    const parsed = signatureConfigInputSchema.safeParse({
      method: "certificate",
      gotenbergUrl: "http://g",
      dssUrl: "http://d",
      tsaUrl: "http://t",
      csc: { baseUrl: "http://c", clientId: "id", clientSecret: "" },
    });

    expect(parsed.success).toBe(true);
  });
});
