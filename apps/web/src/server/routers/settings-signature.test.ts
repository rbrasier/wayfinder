import { describe, expect, it } from "vitest";
import { pdfConverterAvailable, signatureConfigInputSchema } from "./settings-signature";

const builtIn = { source: "built-in" } as const;

describe("signatureConfigInputSchema", () => {
  it("accepts attestation on built-in engines with nothing else", () => {
    const parsed = signatureConfigInputSchema.safeParse({
      method: "attestation",
      pdfConverter: builtIn,
      signatureEngine: builtIn,
      tsaUrl: null,
      csc: null,
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts an external engine with its url, trimmed", () => {
    const parsed = signatureConfigInputSchema.parse({
      method: "drawn",
      pdfConverter: { source: "external", url: "  http://gotenberg:3000 " },
      signatureEngine: builtIn,
      tsaUrl: "  ",
      csc: null,
    });

    expect(parsed.pdfConverter).toEqual({ source: "external", url: "http://gotenberg:3000" });
    expect(parsed.tsaUrl).toBeNull();
  });

  it("rejects an engine source it does not know", () => {
    const parsed = signatureConfigInputSchema.safeParse({
      method: "drawn",
      pdfConverter: { source: "cloud" },
      signatureEngine: builtIn,
      tsaUrl: null,
      csc: null,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown method", () => {
    const parsed = signatureConfigInputSchema.safeParse({
      method: "qualified",
      pdfConverter: builtIn,
      signatureEngine: builtIn,
      tsaUrl: null,
      csc: null,
    });

    expect(parsed.success).toBe(false);
  });

  it("allows a blank client secret so the stored one is kept", () => {
    const parsed = signatureConfigInputSchema.safeParse({
      method: "certificate",
      pdfConverter: builtIn,
      signatureEngine: builtIn,
      tsaUrl: null,
      csc: { baseUrl: "http://c", clientId: "id", clientSecret: "" },
    });

    expect(parsed.success).toBe(true);
  });
});

describe("pdfConverterAvailable", () => {
  it("counts an external converter as available", () => {
    expect(pdfConverterAvailable({ source: "external", url: "http://g" }, "unavailable")).toBe(true);
  });

  it("counts the built-in converter only where this image carries it", () => {
    expect(pdfConverterAvailable(builtIn, "idle")).toBe(true);
    expect(pdfConverterAvailable(builtIn, "unavailable")).toBe(false);
  });
});
