import { describe, expect, it } from "vitest";
import { brandMarkView } from "./brand-mark-model";

describe("brandMarkView", () => {
  it("shows the Wayfinder W tile before branding has loaded", () => {
    expect(brandMarkView(undefined)).toEqual({
      name: "Wayfinder",
      logoSrc: null,
      tileLetter: "W",
    });
  });

  it("shows the Wayfinder W tile when nothing is configured", () => {
    const view = brandMarkView({
      displayName: "Wayfinder",
      customDisplayName: "",
      primaryColour: null,
      logoVersion: null,
    });

    expect(view.logoSrc).toBeNull();
    expect(view.tileLetter).toBe("W");
  });

  it("points the logo at the versioned public route", () => {
    const view = brandMarkView({
      displayName: "Acme",
      customDisplayName: "Acme",
      primaryColour: null,
      logoVersion: 1727085600000,
    });

    expect(view.logoSrc).toBe("/api/branding/logo?v=1727085600000");
    expect(view.name).toBe("Acme");
  });

  it("puts the display name's initial on the tile when there is a name but no logo", () => {
    const view = brandMarkView({
      displayName: "acme procurement",
      customDisplayName: "acme procurement",
      primaryColour: null,
      logoVersion: null,
    });

    expect(view.tileLetter).toBe("A");
  });
});
