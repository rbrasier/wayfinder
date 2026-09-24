import { DEFAULT_BRAND_DISPLAY_NAME } from "@rbrasier/domain";
import type { PublicBranding } from "@/lib/public-branding";

export interface BrandMarkView {
  readonly name: string;
  readonly logoSrc: string | null;
  readonly tileLetter: string;
}

// Undefined while the branding query is in flight: the Wayfinder mark is the
// safe thing to show, and the layouts prefetch so it is rarely seen.
export const brandMarkView = (branding: PublicBranding | undefined): BrandMarkView => {
  const name = branding?.displayName ?? DEFAULT_BRAND_DISPLAY_NAME;
  const logoVersion = branding?.logoVersion ?? null;
  return {
    name,
    logoSrc: logoVersion === null ? null : `/api/branding/logo?v=${logoVersion}`,
    tileLetter: (name.trim()[0] ?? "W").toUpperCase(),
  };
};
