import { DEFAULT_BRAND_PALETTE, resolveBrandPalette, type BrandingConfig } from "@rbrasier/domain";

// The `:root` overrides the root layout renders server-side so the brand colour
// is in the first paint (ADR-060 §2). Every value is produced by the domain from
// a parsed hex colour, never interpolated from stored text, so this block cannot
// carry injected CSS. Null for an unbranded install: globals.css already holds
// the default ramp.
export const buildBrandStyleSheet = (config: BrandingConfig): string | null => {
  const palette = resolveBrandPalette(config);
  if (palette === DEFAULT_BRAND_PALETTE) return null;
  const declarations = [
    `--primary:${palette.primaryHsl}`,
    `--ring:${palette.primaryHsl}`,
    `--primary-foreground:${palette.foregroundHsl}`,
    `--wf-primary:${palette.base}`,
    `--primary-hover:${palette.hover}`,
    `--primary-light:${palette.light}`,
    `--primary-dim:${palette.dim}`,
    `--primary-contrast:${palette.foreground}`,
  ];
  return `:root{${declarations.join(";")};}`;
};
