import { describe, expect, it } from "vitest";
import {
  DEFAULT_SITE_BANNER_LINK_LABEL,
  createDefaultSiteBannerConfig,
  isSiteBannerVisible,
  normaliseSiteBannerColour,
  normaliseSiteBannerLinkUrl,
  normaliseSiteBannerTextSizePt,
  parseSiteBannerConfig,
  resolveSiteBannerLinkLabel,
  SITE_BANNER_MAX_TEXT_SIZE_PT,
  SITE_BANNER_MIN_TEXT_SIZE_PT,
  isExternalSiteBannerLink,
} from "./site-banner";

describe("createDefaultSiteBannerConfig", () => {
  it("is off, with 12pt red text on white and no link", () => {
    expect(createDefaultSiteBannerConfig()).toEqual({
      enabled: false,
      text: "",
      textSizePt: 12,
      textColour: "#dc2626",
      backgroundColour: "#ffffff",
      linkUrl: "",
      linkLabel: "",
    });
  });

  it("returns a fresh object each call so callers cannot mutate the default", () => {
    const first = createDefaultSiteBannerConfig();
    first.enabled = true;
    expect(createDefaultSiteBannerConfig().enabled).toBe(false);
  });
});

describe("normaliseSiteBannerColour", () => {
  it("accepts a six-digit hex colour", () => {
    expect(normaliseSiteBannerColour("#1A2B3C", "#ffffff")).toBe("#1a2b3c");
  });

  it("falls back for a three-digit shorthand, a bare name or a CSS expression", () => {
    expect(normaliseSiteBannerColour("#fff", "#ffffff")).toBe("#ffffff");
    expect(normaliseSiteBannerColour("red", "#ffffff")).toBe("#ffffff");
    expect(normaliseSiteBannerColour("url(https://evil.test/x)", "#ffffff")).toBe("#ffffff");
  });

  it("falls back for a non-string", () => {
    expect(normaliseSiteBannerColour(42, "#000000")).toBe("#000000");
    expect(normaliseSiteBannerColour(null, "#000000")).toBe("#000000");
  });
});

describe("normaliseSiteBannerTextSizePt", () => {
  it("keeps a size inside the supported range", () => {
    expect(normaliseSiteBannerTextSizePt(18, 12)).toBe(18);
  });

  it("clamps to the supported range rather than rejecting", () => {
    expect(normaliseSiteBannerTextSizePt(2, 12)).toBe(SITE_BANNER_MIN_TEXT_SIZE_PT);
    expect(normaliseSiteBannerTextSizePt(400, 12)).toBe(SITE_BANNER_MAX_TEXT_SIZE_PT);
  });

  it("rounds a fractional size to a whole point", () => {
    expect(normaliseSiteBannerTextSizePt(13.6, 12)).toBe(14);
  });

  it("falls back for a non-finite or non-numeric size", () => {
    expect(normaliseSiteBannerTextSizePt(Number.NaN, 12)).toBe(12);
    expect(normaliseSiteBannerTextSizePt("16", 12)).toBe(12);
  });
});

describe("normaliseSiteBannerLinkUrl", () => {
  it("accepts http, https and site-relative URLs", () => {
    expect(normaliseSiteBannerLinkUrl("https://status.example.com")).toBe(
      "https://status.example.com",
    );
    expect(normaliseSiteBannerLinkUrl("http://status.example.com")).toBe(
      "http://status.example.com",
    );
    expect(normaliseSiteBannerLinkUrl("/admin/settings")).toBe("/admin/settings");
  });

  it("trims surrounding whitespace", () => {
    expect(normaliseSiteBannerLinkUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("rejects a scheme that could execute or embed script", () => {
    expect(normaliseSiteBannerLinkUrl("javascript:alert(1)")).toBe("");
    expect(normaliseSiteBannerLinkUrl("JavaScript:alert(1)")).toBe("");
    expect(normaliseSiteBannerLinkUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
    expect(normaliseSiteBannerLinkUrl("vbscript:msgbox(1)")).toBe("");
  });

  it("rejects a protocol-relative URL, which would inherit any scheme", () => {
    expect(normaliseSiteBannerLinkUrl("//evil.test/x")).toBe("");
  });

  it("rejects a bare host with no scheme", () => {
    expect(normaliseSiteBannerLinkUrl("example.com")).toBe("");
  });

  it("returns empty for a blank or non-string value", () => {
    expect(normaliseSiteBannerLinkUrl("")).toBe("");
    expect(normaliseSiteBannerLinkUrl("   ")).toBe("");
    expect(normaliseSiteBannerLinkUrl(undefined)).toBe("");
  });
});

describe("isExternalSiteBannerLink", () => {
  it("treats absolute URLs as external and relative paths as internal", () => {
    expect(isExternalSiteBannerLink("https://status.example.com")).toBe(true);
    expect(isExternalSiteBannerLink("http://status.example.com")).toBe(true);
    expect(isExternalSiteBannerLink("/admin/settings")).toBe(false);
    expect(isExternalSiteBannerLink("")).toBe(false);
  });
});

describe("resolveSiteBannerLinkLabel", () => {
  it("uses the configured label when set", () => {
    expect(resolveSiteBannerLinkLabel("View status")).toBe("View status");
  });

  it("falls back to the default label when blank", () => {
    expect(resolveSiteBannerLinkLabel("")).toBe(DEFAULT_SITE_BANNER_LINK_LABEL);
    expect(resolveSiteBannerLinkLabel("   ")).toBe(DEFAULT_SITE_BANNER_LINK_LABEL);
  });
});

describe("isSiteBannerVisible", () => {
  it("is hidden when disabled, even with text", () => {
    const config = { ...createDefaultSiteBannerConfig(), text: "Maintenance tonight" };
    expect(isSiteBannerVisible(config)).toBe(false);
  });

  it("is hidden when enabled with blank text, so an empty strip never appears", () => {
    const config = { ...createDefaultSiteBannerConfig(), enabled: true, text: "   " };
    expect(isSiteBannerVisible(config)).toBe(false);
  });

  it("is visible when enabled with text", () => {
    const config = {
      ...createDefaultSiteBannerConfig(),
      enabled: true,
      text: "Maintenance tonight",
    };
    expect(isSiteBannerVisible(config)).toBe(true);
  });
});

describe("parseSiteBannerConfig", () => {
  const defaults = createDefaultSiteBannerConfig();

  it("round-trips a fully specified config", () => {
    const stored = {
      enabled: true,
      text: "Scheduled maintenance 8pm",
      textSizePt: 16,
      textColour: "#ffffff",
      backgroundColour: "#b91c1c",
      linkUrl: "https://status.example.com",
      linkLabel: "View status",
    };
    expect(parseSiteBannerConfig(JSON.stringify(stored))).toEqual(stored);
  });

  it("falls back field by field, keeping the valid ones", () => {
    const raw = JSON.stringify({
      enabled: true,
      text: "Heads up",
      textSizePt: "huge",
      textColour: "not-a-colour",
      backgroundColour: "#000000",
      linkUrl: "javascript:alert(1)",
    });
    expect(parseSiteBannerConfig(raw)).toEqual({
      enabled: true,
      text: "Heads up",
      textSizePt: defaults.textSizePt,
      textColour: defaults.textColour,
      backgroundColour: "#000000",
      linkUrl: "",
      linkLabel: "",
    });
  });

  it("falls back to the defaults on malformed JSON", () => {
    expect(parseSiteBannerConfig("{not json")).toEqual(defaults);
  });

  it("falls back to the defaults when the stored value is not an object", () => {
    expect(parseSiteBannerConfig("\"a string\"")).toEqual(defaults);
    expect(parseSiteBannerConfig("null")).toEqual(defaults);
    expect(parseSiteBannerConfig("[]")).toEqual(defaults);
  });

  it("honours a caller-supplied fallback", () => {
    const fallback = { ...defaults, textColour: "#123456" };
    expect(parseSiteBannerConfig("{}", fallback).textColour).toBe("#123456");
  });
});
