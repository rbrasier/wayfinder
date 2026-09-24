import { describe, expect, it } from "vitest";
import { toPublicBranding } from "@/lib/public-branding";
import { brandingInputSchema, loginNoticeInputSchema } from "./settings-presentation";

describe("toPublicBranding", () => {
  it("never exposes the storage key of the logo", () => {
    const view = toPublicBranding({
      displayName: "Acme",
      primaryColour: "#0f766e",
      logo: { key: "branding/logo-1727085600000", mimeType: "image/png", version: 1727085600000 },
    });

    expect(view).toEqual({
      displayName: "Acme",
      customDisplayName: "Acme",
      primaryColour: "#0f766e",
      logoVersion: 1727085600000,
    });
    expect(JSON.stringify(view)).not.toContain("branding/");
  });

  it("names the install Wayfinder when no display name is set", () => {
    const view = toPublicBranding({ displayName: "", primaryColour: null, logo: null });

    expect(view.displayName).toBe("Wayfinder");
    expect(view.customDisplayName).toBe("");
    expect(view.logoVersion).toBeNull();
  });
});

describe("loginNoticeInputSchema", () => {
  it("accepts the three modes and nothing else", () => {
    expect(loginNoticeInputSchema.safeParse({ mode: "every_sign_in", text: "Hi" }).success).toBe(true);
    expect(loginNoticeInputSchema.safeParse({ mode: "always", text: "Hi" }).success).toBe(false);
  });
});

describe("brandingInputSchema", () => {
  it("accepts a cleared colour", () => {
    expect(brandingInputSchema.safeParse({ displayName: "", primaryColour: null }).success).toBe(true);
  });
});
