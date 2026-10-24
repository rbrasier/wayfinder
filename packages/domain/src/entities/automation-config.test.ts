import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTOMATION_CONFIG,
  parseAutomationConfig,
  validateAutomationConfig,
} from "./automation-config";

describe("parseAutomationConfig", () => {
  it("reads both lists from a stored row", () => {
    const config = parseAutomationConfig(
      JSON.stringify({ watchAllowedHosts: ["api.internal"], emailAllowedDomains: ["agency.gov.au"] }),
    );

    expect(config).toEqual({ watchAllowedHosts: ["api.internal"], emailAllowedDomains: ["agency.gov.au"] });
  });

  it("falls back to empty lists for a malformed row rather than throwing", () => {
    expect(parseAutomationConfig("{not json")).toEqual(DEFAULT_AUTOMATION_CONFIG);
  });

  it("drops non-string entries and blanks, and lower-cases what remains", () => {
    const config = parseAutomationConfig(
      JSON.stringify({ watchAllowedHosts: [" API.Internal ", 3, ""], emailAllowedDomains: "nope" }),
    );

    expect(config).toEqual({ watchAllowedHosts: ["api.internal"], emailAllowedDomains: [] });
  });
});

describe("validateAutomationConfig", () => {
  it("accepts plain hostnames and domains", () => {
    const problems = validateAutomationConfig({
      watchAllowedHosts: ["10.0.0.5", "hearings.internal"],
      emailAllowedDomains: ["agency.gov.au"],
    });

    expect(problems).toEqual([]);
  });

  it("rejects wildcards, schemes and paths with the offending entry named", () => {
    const problems = validateAutomationConfig({
      watchAllowedHosts: ["*.internal", "https://api.internal"],
      emailAllowedDomains: ["agency.gov.au/x"],
    });

    expect(problems).toEqual([
      "*.internal is not a valid host name.",
      "https://api.internal is not a valid host name.",
      "agency.gov.au/x is not a valid email domain.",
    ]);
  });
});
