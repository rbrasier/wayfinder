import { resolveBrandDisplayName, type BrandingConfig } from "@rbrasier/domain";

// What any visitor may see of the branding. The storage key stays server-side:
// the logo is only ever fetched through /api/branding/logo, which reads the key
// itself (ADR-060 §4).
export interface PublicBranding {
  readonly displayName: string;
  // The admin's own value, blank when they have not set one; the settings card
  // edits this rather than the resolved "Wayfinder".
  readonly customDisplayName: string;
  readonly primaryColour: string | null;
  readonly logoVersion: number | null;
}

export const toPublicBranding = (config: BrandingConfig): PublicBranding => ({
  displayName: resolveBrandDisplayName(config),
  customDisplayName: config.displayName,
  primaryColour: config.primaryColour,
  logoVersion: config.logo?.version ?? null,
});
