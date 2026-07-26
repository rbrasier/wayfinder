import { describe, expect, it } from "vitest";
import { createDefaultSiteBannerConfig } from "@rbrasier/domain";
import { SiteBanner, buildSiteBannerStyle } from "./site-banner";

describe("SiteBanner", () => {
  it("exports a function component", () => {
    expect(typeof SiteBanner).toBe("function");
  });

  it("component name is SiteBanner", () => {
    expect(SiteBanner.name).toBe("SiteBanner");
  });
});

describe("buildSiteBannerStyle", () => {
  it("maps the configured colours and point size onto inline style properties", () => {
    const config = {
      ...createDefaultSiteBannerConfig(),
      textSizePt: 16,
      textColour: "#ffffff",
      backgroundColour: "#b91c1c",
    };

    expect(buildSiteBannerStyle(config)).toEqual({
      backgroundColor: "#b91c1c",
      color: "#ffffff",
      fontSize: "16pt",
    });
  });

  it("uses the 12pt red-on-white default", () => {
    expect(buildSiteBannerStyle(createDefaultSiteBannerConfig())).toEqual({
      backgroundColor: "#ffffff",
      color: "#dc2626",
      fontSize: "12pt",
    });
  });
});
