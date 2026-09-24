import { describe, expect, it } from "vitest";
import { createDefaultBrandingConfig } from "@rbrasier/domain";
import { buildBrandStyleSheet } from "./brand-style";

describe("buildBrandStyleSheet", () => {
  it("emits nothing for an unbranded install, so its HTML is unchanged", () => {
    expect(buildBrandStyleSheet(createDefaultBrandingConfig())).toBeNull();
  });

  it("overrides every primary token from the configured colour", () => {
    const css = buildBrandStyleSheet({ ...createDefaultBrandingConfig(), primaryColour: "#0f766e" });

    expect(css).toContain("--wf-primary:#0f766e;");
    for (const token of [
      "--primary:",
      "--ring:",
      "--primary-foreground:",
      "--primary-hover:",
      "--primary-light:",
      "--primary-dim:",
      "--primary-contrast:",
    ]) {
      expect(css).toContain(token);
    }
    expect(css?.startsWith(":root{")).toBe(true);
  });

  it("keeps white text on a colour that only just passes the page rule", () => {
    const css = buildBrandStyleSheet({ ...createDefaultBrandingConfig(), primaryColour: "#737373" });

    expect(css).toContain("--primary-contrast:#ffffff;");
  });

  it("can only ever contain hex colours and HSL triplets", () => {
    const css = buildBrandStyleSheet({ ...createDefaultBrandingConfig(), primaryColour: "#8b2252" }) ?? "";

    const values = css
      .replace(/^:root\{|\}$/g, "")
      .split(";")
      .filter(Boolean)
      .map((declaration) => declaration.split(":")[1]);
    for (const value of values) {
      expect(value).toMatch(/^(#[0-9a-f]{6}|\d{1,3} \d{1,3}% \d{1,3}%)$/);
    }
  });
});
