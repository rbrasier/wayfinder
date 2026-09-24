import { describe, expect, it } from "vitest";
import { brandColourCheck, canSaveBranding } from "./branding-card-model";

describe("brandColourCheck", () => {
  it("treats a blank colour as the Wayfinder default, which is always allowed", () => {
    expect(brandColourCheck("   ")).toEqual({ state: "default" });
  });

  it("asks for hex while the admin is mid-edit", () => {
    expect(brandColourCheck("#2f5")).toEqual({
      state: "invalid",
      message: "Use a six-digit hex colour, e.g. #2f56d3",
    });
  });

  it("passes a readable colour and reports its ratio", () => {
    const check = brandColourCheck("#0f766e");

    expect(check.state).toBe("pass");
    expect(check.state === "pass" && check.ratio).toBeGreaterThanOrEqual(4.5);
    expect(check.state === "pass" && check.label).toMatch(/^\d+\.\d:1 against the page — readable$/);
  });

  it("fails a light colour with the same message the server gives", () => {
    const check = brandColourCheck("#ffd24a");

    expect(check.state).toBe("fail");
    expect(check.state === "fail" && check.message).toMatch(
      /^Too light to read as link text on the page background \(1\.\d:1, needs 4\.5:1\)$/,
    );
  });
});

describe("canSaveBranding", () => {
  it("allows a default or passing colour with a name in range", () => {
    expect(canSaveBranding("Acme", brandColourCheck(""))).toBe(true);
    expect(canSaveBranding("Acme", brandColourCheck("#0f766e"))).toBe(true);
  });

  it("blocks a failing or unfinished colour", () => {
    expect(canSaveBranding("Acme", brandColourCheck("#ffd24a"))).toBe(false);
    expect(canSaveBranding("Acme", brandColourCheck("#0f7"))).toBe(false);
  });

  it("blocks a name over 40 characters", () => {
    expect(canSaveBranding("x".repeat(41), brandColourCheck(""))).toBe(false);
  });
});
