// A single strip across the top of every page, for notifications and site
// warnings ("maintenance tonight", "SSO degraded"). Admin-configurable and
// stored as one JSON row in admin_system_settings, so operators can raise a
// notice without a redeploy.
export interface SiteBannerConfig {
  enabled: boolean;
  text: string;
  textSizePt: number;
  // #rrggbb — these reach the DOM as inline style values.
  textColour: string;
  backgroundColour: string;
  // Empty means the banner is text only.
  linkUrl: string;
  // Empty falls back to DEFAULT_SITE_BANNER_LINK_LABEL.
  linkLabel: string;
}

export const SITE_BANNER_CONFIG_SETTING_KEY = "site_banner_config";

export const DEFAULT_SITE_BANNER_TEXT_SIZE_PT = 12;
export const DEFAULT_SITE_BANNER_TEXT_COLOUR = "#dc2626";
export const DEFAULT_SITE_BANNER_BACKGROUND_COLOUR = "#ffffff";
export const DEFAULT_SITE_BANNER_LINK_LABEL = "Learn more";

// Below 8pt the strip is unreadable; above 32pt it stops being a strip and
// starts eating the viewport the rest of the layout is sized against.
export const SITE_BANNER_MIN_TEXT_SIZE_PT = 8;
export const SITE_BANNER_MAX_TEXT_SIZE_PT = 32;

export const createDefaultSiteBannerConfig = (): SiteBannerConfig => ({
  enabled: false,
  text: "",
  textSizePt: DEFAULT_SITE_BANNER_TEXT_SIZE_PT,
  textColour: DEFAULT_SITE_BANNER_TEXT_COLOUR,
  backgroundColour: DEFAULT_SITE_BANNER_BACKGROUND_COLOUR,
  linkUrl: "",
  linkLabel: "",
});

const HEX_COLOUR_PATTERN = /^#[0-9a-f]{6}$/i;

// Only full six-digit hex is accepted. The value is written straight into an
// inline style, so anything that is not provably a colour — a bare keyword, a
// url(), a var() — falls back rather than reaching the DOM.
export const normaliseSiteBannerColour = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!HEX_COLOUR_PATTERN.test(trimmed)) return fallback;
  return trimmed.toLowerCase();
};

export const normaliseSiteBannerTextSizePt = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < SITE_BANNER_MIN_TEXT_SIZE_PT) return SITE_BANNER_MIN_TEXT_SIZE_PT;
  if (rounded > SITE_BANNER_MAX_TEXT_SIZE_PT) return SITE_BANNER_MAX_TEXT_SIZE_PT;
  return rounded;
};

// The URL becomes an href, so the accepted shapes are limited to http(s) and
// site-relative paths. This is what keeps javascript:, data: and vbscript: out
// of the DOM. Protocol-relative "//host" is rejected too: it inherits whatever
// scheme the page was served over and reads like a path at a glance.
export const normaliseSiteBannerLinkUrl = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "";
  if (trimmed.startsWith("//")) return "";
  if (trimmed.startsWith("/")) return trimmed;
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("https://") || lowered.startsWith("http://")) return trimmed;
  return "";
};

export const isExternalSiteBannerLink = (url: string): boolean => {
  const lowered = url.toLowerCase();
  return lowered.startsWith("https://") || lowered.startsWith("http://");
};

export const resolveSiteBannerLinkLabel = (label: string): string => {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_SITE_BANNER_LINK_LABEL;
};

// An enabled banner with nothing to say would render an empty coloured strip on
// every page, so blank text hides it just as firmly as the toggle does.
export const isSiteBannerVisible = (config: SiteBannerConfig): boolean =>
  config.enabled && config.text.trim().length > 0;

// Tolerant parse: a malformed row degrades field by field to the defaults
// rather than throwing on a path that runs for every page render.
export const parseSiteBannerConfig = (
  raw: string,
  fallback: SiteBannerConfig = createDefaultSiteBannerConfig(),
): SiteBannerConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fallback;
    const source = parsed as Record<string, unknown>;
    return {
      enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
      text: typeof source.text === "string" ? source.text : fallback.text,
      textSizePt: normaliseSiteBannerTextSizePt(source.textSizePt, fallback.textSizePt),
      textColour: normaliseSiteBannerColour(source.textColour, fallback.textColour),
      backgroundColour: normaliseSiteBannerColour(
        source.backgroundColour,
        fallback.backgroundColour,
      ),
      linkUrl: normaliseSiteBannerLinkUrl(source.linkUrl),
      linkLabel: typeof source.linkLabel === "string" ? source.linkLabel : fallback.linkLabel,
    };
  } catch {
    return fallback;
  }
};
