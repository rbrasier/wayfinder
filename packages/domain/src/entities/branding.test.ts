import { describe, expect, it } from "vitest";
import {
  BRANDING_DISPLAY_NAME_MAX_LENGTH,
  DEFAULT_BRAND_DISPLAY_NAME,
  DEFAULT_BRAND_PALETTE,
  brandingLogoKey,
  createDefaultBrandingConfig,
  deriveBrandPalette,
  parseBrandingConfig,
  resolveBrandDisplayName,
  resolveBrandPalette,
  sniffLogoMimeType,
  validateBrandColour,
  validateBrandDisplayName,
} from "./branding";
import { BRAND_TEXT_CONTRAST_MINIMUM, hexContrastRatio } from "./colour-contrast";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const ascii = (text: string): number[] => [...text].map((character) => character.charCodeAt(0));

describe("DEFAULT_BRAND_PALETTE", () => {
  it("is today's Wayfinder blue ramp, verbatim", () => {
    expect(DEFAULT_BRAND_PALETTE).toEqual({
      base: "#2f56d3",
      hover: "#1f3ea8",
      light: "#eaeefb",
      dim: "#c3cef2",
      foreground: "#ffffff",
      primaryHsl: "226 64% 51%",
      foregroundHsl: "0 0% 100%",
    });
  });
});

describe("resolveBrandPalette", () => {
  it("uses the default constant, not a derivation, when no colour is set", () => {
    expect(resolveBrandPalette(createDefaultBrandingConfig())).toBe(DEFAULT_BRAND_PALETTE);
  });

  it("derives a palette from a configured colour", () => {
    const config = { ...createDefaultBrandingConfig(), primaryColour: "#0f766e" };

    expect(resolveBrandPalette(config).base).toBe("#0f766e");
  });
});

describe("deriveBrandPalette", () => {
  it("lands close to the hand-picked Wayfinder ramp when given Wayfinder blue", () => {
    const palette = deriveBrandPalette("#2f56d3");

    expect(palette.base).toBe("#2f56d3");
    // globals.css rounds the hand-set token to 64%; the maths gives 65%. The
    // default constant keeps 64% so an unbranded install is unchanged.
    expect(palette.primaryHsl).toBe("226 65% 51%");
    expect(palette.foreground).toBe("#ffffff");
    expect(palette.foregroundHsl).toBe("0 0% 100%");
    // Within a couple of channel steps of the hand-picked values.
    expect(hexContrastRatio(palette.hover, "#1f3ea8")).toBeLessThan(1.1);
    expect(hexContrastRatio(palette.light, "#eaeefb")).toBeLessThan(1.05);
    expect(hexContrastRatio(palette.dim, "#c3cef2")).toBeLessThan(1.05);
  });

  it("darkens for hover and lightens for the tints", () => {
    const palette = deriveBrandPalette("#0f766e");

    expect(hexContrastRatio(palette.hover, "#ffffff")).toBeGreaterThan(
      hexContrastRatio(palette.base, "#ffffff") ?? 0,
    );
    expect(hexContrastRatio(palette.light, "#ffffff")).toBeLessThan(
      hexContrastRatio(palette.dim, "#ffffff") ?? 0,
    );
  });

  it("picks dark text for a pale colour", () => {
    expect(deriveBrandPalette("#ffd24a").foreground).toBe("#1c1b19");
    expect(deriveBrandPalette("#ffd24a").foregroundHsl).toBe("40 6% 10%");
  });

  it("is deterministic", () => {
    expect(deriveBrandPalette("#8b2252")).toEqual(deriveBrandPalette("#8b2252"));
  });
});

describe("validateBrandColour", () => {
  it("accepts a colour readable as link text on the page background", () => {
    expect(validateBrandColour("#2F56D3")).toEqual({ data: "#2f56d3" });
  });

  it("rejects a colour too light to read, naming the measured ratio", () => {
    const result = validateBrandColour("#ffd24a");

    expect(result.error?.code).toBe("VALIDATION_FAILED");
    expect(result.error?.message).toMatch(/1\.\d:1, needs 4\.5:1/);
  });

  it("rejects anything that is not six-digit hex", () => {
    expect(validateBrandColour("blue").error?.code).toBe("VALIDATION_FAILED");
  });

  it("draws the line at 4.5:1 against the off-white page, not against pure white", () => {
    // #737373 is 4.51:1 on #faf9f7; #747474 is 4.44:1.
    expect(validateBrandColour("#737373").error).toBeUndefined();
    expect(validateBrandColour("#747474").error?.code).toBe("VALIDATION_FAILED");
    expect(hexContrastRatio("#737373", "#faf9f7")).toBeGreaterThanOrEqual(
      BRAND_TEXT_CONTRAST_MINIMUM,
    );
  });
});

describe("validateBrandDisplayName", () => {
  it("trims the name", () => {
    expect(validateBrandDisplayName("  Acme Procurement  ")).toEqual({ data: "Acme Procurement" });
  });

  it("allows blank, which means the Wayfinder default", () => {
    expect(validateBrandDisplayName("   ")).toEqual({ data: "" });
  });

  it("rejects a name longer than the limit", () => {
    const result = validateBrandDisplayName("x".repeat(BRANDING_DISPLAY_NAME_MAX_LENGTH + 1));

    expect(result.error?.code).toBe("VALIDATION_FAILED");
  });
});

describe("resolveBrandDisplayName", () => {
  it("falls back to Wayfinder when no name is set", () => {
    expect(resolveBrandDisplayName(createDefaultBrandingConfig())).toBe(DEFAULT_BRAND_DISPLAY_NAME);
  });

  it("uses the configured name", () => {
    const config = { ...createDefaultBrandingConfig(), displayName: "Acme" };

    expect(resolveBrandDisplayName(config)).toBe("Acme");
  });
});

describe("sniffLogoMimeType", () => {
  it("recognises PNG, JPEG and WebP from their first bytes", () => {
    expect(sniffLogoMimeType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      "image/png",
    );
    expect(sniffLogoMimeType(bytes(0xff, 0xd8, 0xff, 0xe0, 0))).toBe("image/jpeg");
    expect(sniffLogoMimeType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")))).toBe(
      "image/webp",
    );
  });

  it("refuses SVG, even though browsers render it as an image", () => {
    expect(sniffLogoMimeType(bytes(...ascii("<svg xmlns=\"http://www.w3.org/2000/svg\">")))).toBeNull();
  });

  it("refuses GIF and other formats", () => {
    expect(sniffLogoMimeType(bytes(...ascii("GIF89a")))).toBeNull();
    expect(sniffLogoMimeType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")))).toBeNull();
  });

  it("refuses a file truncated before its signature ends", () => {
    expect(sniffLogoMimeType(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(sniffLogoMimeType(bytes())).toBeNull();
  });
});

describe("parseBrandingConfig", () => {
  it("reads a complete row", () => {
    const raw = JSON.stringify({
      displayName: "Acme",
      primaryColour: "#0F766E",
      logo: { key: "branding/logo-3", mimeType: "image/png", version: 3 },
    });

    expect(parseBrandingConfig(raw)).toEqual({
      displayName: "Acme",
      primaryColour: "#0f766e",
      logo: { key: "branding/logo-3", mimeType: "image/png", version: 3 },
    });
  });

  it("returns the defaults for malformed JSON", () => {
    expect(parseBrandingConfig("{not json")).toEqual(createDefaultBrandingConfig());
  });

  it("drops a colour that is not hex rather than letting it reach a style block", () => {
    const raw = JSON.stringify({ primaryColour: "red; } body { display: none" });

    expect(parseBrandingConfig(raw).primaryColour).toBeNull();
  });

  it("drops a logo whose key is outside the branding prefix", () => {
    const raw = JSON.stringify({
      logo: { key: "context/flow-1/secret.pdf", mimeType: "image/png", version: 1 },
    });

    expect(parseBrandingConfig(raw).logo).toBeNull();
  });

  it("drops a logo with a type that is not allowed", () => {
    const raw = JSON.stringify({
      logo: { key: "branding/logo-1", mimeType: "image/svg+xml", version: 1 },
    });

    expect(parseBrandingConfig(raw).logo).toBeNull();
  });
});

describe("brandingLogoKey", () => {
  it("keeps every logo under one fixed prefix", () => {
    expect(brandingLogoKey(4)).toBe("branding/logo-4");
  });
});
