import { describe, expect, it } from "vitest";
import { resolveOrganisationsCardMode } from "./organisations-card-model";

describe("resolveOrganisationsCardMode", () => {
  it("hides the single organisation name once organisations are enabled", () => {
    expect(resolveOrganisationsCardMode(true)).toBe("managed-elsewhere");
  });

  it("shows the single organisation name while organisations are disabled", () => {
    expect(resolveOrganisationsCardMode(false)).toBe("single-name");
  });

  it("shows the single organisation name while the setting is still loading", () => {
    expect(resolveOrganisationsCardMode(undefined)).toBe("single-name");
  });
});
