import { domainError } from "../errors/domain-error";
import { err, ok, type Result } from "../result";
import {
  BRAND_TEXT_CONTRAST_MINIMUM,
  PAGE_BACKGROUND_COLOUR,
  contrastRatio,
  formatHexColour,
  parseHexColour,
  pickReadableForeground,
  type RgbColour,
} from "./colour-contrast";

// Install-wide branding (ADR-060): one logo, one display name and one primary
// colour for everyone. Stored as one JSON row in admin_system_settings
// (ADR-041), so it changes without a redeploy.

export const BRANDING_CONFIG_SETTING_KEY = "branding_config";

export const BRANDING_LOGO_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type BrandingLogoMimeType = (typeof BRANDING_LOGO_MIME_TYPES)[number];

export const BRANDING_LOGO_MAX_BYTES = 512 * 1024;
export const BRANDING_DISPLAY_NAME_MAX_LENGTH = 40;
export const DEFAULT_BRAND_DISPLAY_NAME = "Wayfinder";

// Every logo lives under this prefix. The public logo route serves whatever key
// the config names, so a key outside it is treated as corrupt, never served.
const BRANDING_LOGO_KEY_PREFIX = "branding/";

export interface BrandingLogo {
  readonly key: string;
  readonly mimeType: BrandingLogoMimeType;
  readonly version: number;
}

export interface BrandingConfig {
  // Blank means "Wayfinder".
  readonly displayName: string;
  // Null means the default Wayfinder palette.
  readonly primaryColour: string | null;
  readonly logo: BrandingLogo | null;
}

// Every value a stylesheet needs from the one brand colour. The hex values feed
// the `--wf-primary*` tokens; the HSL triplets feed shadcn's `--primary` and
// `--primary-foreground`, which are written without the hsl() wrapper.
export interface BrandPalette {
  readonly base: string;
  readonly hover: string;
  readonly light: string;
  readonly dim: string;
  readonly foreground: string;
  readonly primaryHsl: string;
  readonly foregroundHsl: string;
}

// Today's hand-picked ramp. An unbranded install uses these literals rather than
// a derivation of #2f56d3, so rounding in the maths can never shift its colours.
export const DEFAULT_BRAND_PALETTE: BrandPalette = {
  base: "#2f56d3",
  hover: "#1f3ea8",
  light: "#eaeefb",
  dim: "#c3cef2",
  foreground: "#ffffff",
  primaryHsl: "226 64% 51%",
  foregroundHsl: "0 0% 100%",
};

export const createDefaultBrandingConfig = (): BrandingConfig => ({
  displayName: "",
  primaryColour: null,
  logo: null,
});

export const brandingLogoKey = (version: number): string =>
  `${BRANDING_LOGO_KEY_PREFIX}logo-${version}`;

interface HslColour {
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
}

const toHsl = (colour: RgbColour): HslColour => {
  const red = colour.red / 255;
  const green = colour.green / 255;
  const blue = colour.blue / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness };
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  const hueSector =
    max === red
      ? ((green - blue) / delta + (green < blue ? 6 : 0))
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return { hue: hueSector * 60, saturation, lightness };
};

const fromHsl = (colour: HslColour): RgbColour => {
  const chroma = (1 - Math.abs(2 * colour.lightness - 1)) * colour.saturation;
  const hueSector = colour.hue / 60;
  const second = chroma * (1 - Math.abs((hueSector % 2) - 1));
  const offset = colour.lightness - chroma / 2;
  const [red, green, blue] =
    hueSector < 1
      ? [chroma, second, 0]
      : hueSector < 2
        ? [second, chroma, 0]
        : hueSector < 3
          ? [0, chroma, second]
          : hueSector < 4
            ? [0, second, chroma]
            : hueSector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  return { red: (red + offset) * 255, green: (green + offset) * 255, blue: (blue + offset) * 255 };
};

const formatHslTriplet = (colour: HslColour): string =>
  `${Math.round(colour.hue) % 360} ${Math.round(colour.saturation * 100)}% ${Math.round(colour.lightness * 100)}%`;

const mixTowardsWhite = (colour: RgbColour, baseShare: number): RgbColour => ({
  red: 255 - baseShare * (255 - colour.red),
  green: 255 - baseShare * (255 - colour.green),
  blue: 255 - baseShare * (255 - colour.blue),
});

// The ratios reproduce the hand-picked ramp from Wayfinder blue: hover is 12
// lightness points darker, and the light and dim tints are the base at 10% and
// 29% over white.
const HOVER_LIGHTNESS_DROP = 0.12;
const LIGHT_TINT_BASE_SHARE = 0.1;
const DIM_TINT_BASE_SHARE = 0.29;

export const deriveBrandPalette = (baseHex: string): BrandPalette => {
  const base = parseHexColour(baseHex);
  if (!base) return DEFAULT_BRAND_PALETTE;
  const baseHsl = toHsl(base);
  const foreground = pickReadableForeground(baseHex);
  const foregroundRgb = parseHexColour(foreground) ?? { red: 255, green: 255, blue: 255 };
  return {
    base: formatHexColour(base),
    hover: formatHexColour(
      fromHsl({ ...baseHsl, lightness: Math.max(0, baseHsl.lightness - HOVER_LIGHTNESS_DROP) }),
    ),
    light: formatHexColour(mixTowardsWhite(base, LIGHT_TINT_BASE_SHARE)),
    dim: formatHexColour(mixTowardsWhite(base, DIM_TINT_BASE_SHARE)),
    foreground,
    primaryHsl: formatHslTriplet(baseHsl),
    foregroundHsl: formatHslTriplet(toHsl(foregroundRgb)),
  };
};

export const resolveBrandPalette = (config: BrandingConfig): BrandPalette =>
  config.primaryColour ? deriveBrandPalette(config.primaryColour) : DEFAULT_BRAND_PALETTE;

export const resolveBrandDisplayName = (config: BrandingConfig): string => {
  const trimmed = config.displayName.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_BRAND_DISPLAY_NAME;
};

// The brand colour is used as link text on the page background, so it must be
// readable there (ADR-060 §3). Returns the colour normalised to lower case.
export const validateBrandColour = (value: string): Result<string> => {
  const colour = parseHexColour(value.trim());
  const background = parseHexColour(PAGE_BACKGROUND_COLOUR);
  if (!colour || !background) {
    return err(domainError("VALIDATION_FAILED", "Use a six-digit hex colour, e.g. #2f56d3"));
  }
  const ratio = contrastRatio(colour, background);
  if (ratio < BRAND_TEXT_CONTRAST_MINIMUM) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Too light to read as link text on the page background (${ratio.toFixed(1)}:1, needs ${BRAND_TEXT_CONTRAST_MINIMUM}:1)`,
      ),
    );
  }
  return ok(formatHexColour(colour));
};

export const validateBrandDisplayName = (value: string): Result<string> => {
  const trimmed = value.trim();
  if (trimmed.length > BRANDING_DISPLAY_NAME_MAX_LENGTH) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Keep the display name to ${BRANDING_DISPLAY_NAME_MAX_LENGTH} characters or fewer`,
      ),
    );
  }
  return ok(trimmed);
};

const startsWithBytes = (content: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  content.length >= offset + signature.length &&
  signature.every((byte, index) => content[offset + index] === byte);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];

// The type comes from the file's own bytes, never its name or the browser's
// claim. SVG has no signature here and so is refused: served from our origin it
// can run script (ADR-060 §4).
export const sniffLogoMimeType = (content: Uint8Array): BrandingLogoMimeType | null => {
  if (startsWithBytes(content, PNG_SIGNATURE)) return "image/png";
  if (startsWithBytes(content, JPEG_SIGNATURE)) return "image/jpeg";
  if (startsWithBytes(content, RIFF_SIGNATURE) && startsWithBytes(content, WEBP_SIGNATURE, 8)) {
    return "image/webp";
  }
  return null;
};

const isBrandingLogoMimeType = (value: unknown): value is BrandingLogoMimeType =>
  typeof value === "string" && (BRANDING_LOGO_MIME_TYPES as readonly string[]).includes(value);

const parseBrandingLogo = (value: unknown): BrandingLogo | null => {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.key !== "string" || !source.key.startsWith(BRANDING_LOGO_KEY_PREFIX)) return null;
  if (!isBrandingLogoMimeType(source.mimeType)) return null;
  if (typeof source.version !== "number" || !Number.isInteger(source.version) || source.version < 1) {
    return null;
  }
  return { key: source.key, mimeType: source.mimeType, version: source.version };
};

const parsePrimaryColour = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const colour = parseHexColour(value.trim());
  return colour ? formatHexColour(colour) : null;
};

// Tolerant parse: this runs on every page render, so a malformed row degrades
// field by field to the defaults rather than throwing.
export const parseBrandingConfig = (
  raw: string,
  fallback: BrandingConfig = createDefaultBrandingConfig(),
): BrandingConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fallback;
    const source = parsed as Record<string, unknown>;
    return {
      displayName:
        typeof source.displayName === "string"
          ? source.displayName.slice(0, BRANDING_DISPLAY_NAME_MAX_LENGTH)
          : fallback.displayName,
      primaryColour: parsePrimaryColour(source.primaryColour),
      logo: parseBrandingLogo(source.logo),
    };
  } catch {
    return fallback;
  }
};
