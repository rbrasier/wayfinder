import {
  BRANDING_DISPLAY_NAME_MAX_LENGTH,
  PAGE_BACKGROUND_COLOUR,
  hexContrastRatio,
  validateBrandColour,
} from "@rbrasier/domain";

// The live contrast readout on the branding card. It runs the same domain rule
// the server applies on save (ADR-060 §3), so Save is disabled for exactly the
// colours the server would reject, with the same wording.
export type BrandColourCheck =
  | { readonly state: "default" }
  | { readonly state: "invalid"; readonly message: string }
  | { readonly state: "fail"; readonly ratio: number; readonly message: string }
  | { readonly state: "pass"; readonly ratio: number; readonly label: string };

export const brandColourCheck = (input: string): BrandColourCheck => {
  const trimmed = input.trim();
  if (trimmed.length === 0) return { state: "default" };
  const ratio = hexContrastRatio(trimmed, PAGE_BACKGROUND_COLOUR);
  const validated = validateBrandColour(trimmed);
  if (ratio === null) {
    return { state: "invalid", message: validated.error?.message ?? "Use a six-digit hex colour" };
  }
  if (validated.error) return { state: "fail", ratio, message: validated.error.message };
  return { state: "pass", ratio, label: `${ratio.toFixed(1)}:1 against the page — readable` };
};

export const canSaveBranding = (displayName: string, colour: BrandColourCheck): boolean =>
  displayName.trim().length <= BRANDING_DISPLAY_NAME_MAX_LENGTH &&
  (colour.state === "default" || colour.state === "pass");
