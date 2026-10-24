import { describe, expect, it } from "vitest";
import { automationConfigInputSchema } from "./settings-automation";

describe("automationConfigInputSchema", () => {
  it("accepts host names and email domains", () => {
    const parsed = automationConfigInputSchema.safeParse({
      watchAllowedHosts: ["hearings.internal"],
      emailAllowedDomains: ["agency.gov.au"],
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a wildcard host with the domain's own message", () => {
    const parsed = automationConfigInputSchema.safeParse({
      watchAllowedHosts: ["*.internal"],
      emailAllowedDomains: [],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe("*.internal is not a valid host name.");
  });

  it("trims and lower-cases entries and drops blanks before validating", () => {
    const parsed = automationConfigInputSchema.parse({
      watchAllowedHosts: ["  API.Internal ", ""],
      emailAllowedDomains: [],
    });

    expect(parsed.watchAllowedHosts).toEqual(["api.internal"]);
  });
});
