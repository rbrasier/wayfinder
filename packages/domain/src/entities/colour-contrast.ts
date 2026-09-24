// WCAG 2.1 colour contrast (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio).
// Pure maths, so the brand-colour guard rail (ADR-060 §3) runs the same on the
// admin's screen as it does on save.

export interface RgbColour {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

// AA for normal-size text.
export const BRAND_TEXT_CONTRAST_MINIMUM = 4.5;

// The app's page background (`--bg`). Brand colour is used as link text on it,
// so this is the surface the brand colour has to stay readable against.
export const PAGE_BACKGROUND_COLOUR = "#faf9f7";

export const LIGHT_FOREGROUND_COLOUR = "#ffffff";
export const DARK_FOREGROUND_COLOUR = "#1c1b19";

const HEX_COLOUR_PATTERN = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export const parseHexColour = (value: string): RgbColour | null => {
  const match = HEX_COLOUR_PATTERN.exec(value);
  if (!match) return null;
  return {
    red: parseInt(match[1] ?? "0", 16),
    green: parseInt(match[2] ?? "0", 16),
    blue: parseInt(match[3] ?? "0", 16),
  };
};

const toHexChannel = (channel: number): string =>
  Math.min(255, Math.max(0, Math.round(channel))).toString(16).padStart(2, "0");

export const formatHexColour = (colour: RgbColour): string =>
  `#${toHexChannel(colour.red)}${toHexChannel(colour.green)}${toHexChannel(colour.blue)}`;

const linearise = (channel: number): number => {
  const scaled = channel / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (colour: RgbColour): number =>
  0.2126 * linearise(colour.red) + 0.7152 * linearise(colour.green) + 0.0722 * linearise(colour.blue);

export const contrastRatio = (first: RgbColour, second: RgbColour): number => {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

export const hexContrastRatio = (firstHex: string, secondHex: string): number | null => {
  const first = parseHexColour(firstHex);
  const second = parseHexColour(secondHex);
  if (!first || !second) return null;
  return contrastRatio(first, second);
};

// Whichever of the two text colours stands out more. Any colour that passes the
// page-background rule is dark enough that white clears 4.5:1 on it, so the
// admin never has to choose a text colour themselves.
export const pickReadableForeground = (backgroundHex: string): string => {
  const againstLight = hexContrastRatio(backgroundHex, LIGHT_FOREGROUND_COLOUR);
  const againstDark = hexContrastRatio(backgroundHex, DARK_FOREGROUND_COLOUR);
  if (againstLight === null || againstDark === null) return LIGHT_FOREGROUND_COLOUR;
  return againstLight >= againstDark ? LIGHT_FOREGROUND_COLOUR : DARK_FOREGROUND_COLOUR;
};
