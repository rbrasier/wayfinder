import { describe, expect, it } from "vitest";
import {
  BRAND_TEXT_CONTRAST_MINIMUM,
  DARK_FOREGROUND_COLOUR,
  LIGHT_FOREGROUND_COLOUR,
  formatHexColour,
  hexContrastRatio,
  parseHexColour,
  pickReadableForeground,
  relativeLuminance,
} from "./colour-contrast";

describe("parseHexColour", () => {
  it("reads a six-digit hex colour in either case", () => {
    expect(parseHexColour("#2f56d3")).toEqual({ red: 47, green: 86, blue: 211 });
    expect(parseHexColour("#2F56D3")).toEqual({ red: 47, green: 86, blue: 211 });
  });

  it("refuses anything that is not a full six-digit hex colour", () => {
    expect(parseHexColour("#fff")).toBeNull();
    expect(parseHexColour("2f56d3")).toBeNull();
    expect(parseHexColour("red")).toBeNull();
    expect(parseHexColour("#2f56d3; background: url(x)")).toBeNull();
  });
});

describe("formatHexColour", () => {
  it("writes lower-case six-digit hex, rounding and clamping each channel", () => {
    expect(formatHexColour({ red: 47, green: 86, blue: 211 })).toBe("#2f56d3");
    expect(formatHexColour({ red: 300, green: -4, blue: 10.6 })).toBe("#ff000b");
  });
});

describe("relativeLuminance", () => {
  it("is 0 for black and 1 for white", () => {
    expect(relativeLuminance({ red: 0, green: 0, blue: 0 })).toBe(0);
    expect(relativeLuminance({ red: 255, green: 255, blue: 255 })).toBe(1);
  });
});

describe("hexContrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(hexContrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(hexContrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // The two greys either side of the 4.5:1 AA line on white.
    expect(hexContrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(hexContrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  it("is symmetric", () => {
    expect(hexContrastRatio("#2f56d3", "#faf9f7")).toBeCloseTo(
      hexContrastRatio("#faf9f7", "#2f56d3") ?? 0,
      10,
    );
  });

  it("returns null when either colour is not valid hex", () => {
    expect(hexContrastRatio("blue", "#ffffff")).toBeNull();
  });
});

describe("pickReadableForeground", () => {
  it("puts white text on Wayfinder blue", () => {
    expect(pickReadableForeground("#2f56d3")).toBe(LIGHT_FOREGROUND_COLOUR);
  });

  it("puts dark text on a pale colour", () => {
    expect(pickReadableForeground("#ffd24a")).toBe(DARK_FOREGROUND_COLOUR);
  });

  it("falls back to white for an unreadable input", () => {
    expect(pickReadableForeground("not-a-colour")).toBe(LIGHT_FOREGROUND_COLOUR);
  });

  it("always reaches AA on any colour dark enough to be link text on the page", () => {
    // Every colour that passes the brand rule (≥ 4.5:1 against the page
    // background) must also get a foreground that reaches 4.5:1 on top of it.
    for (let red = 0; red <= 255; red += 17) {
      for (let green = 0; green <= 255; green += 17) {
        for (let blue = 0; blue <= 255; blue += 17) {
          const colour = formatHexColour({ red, green, blue });
          const againstPage = hexContrastRatio(colour, "#faf9f7") ?? 0;
          if (againstPage < BRAND_TEXT_CONTRAST_MINIMUM) continue;
          const foreground = pickReadableForeground(colour);
          expect(hexContrastRatio(colour, foreground)).toBeGreaterThanOrEqual(
            BRAND_TEXT_CONTRAST_MINIMUM,
          );
        }
      }
    }
  });
});
