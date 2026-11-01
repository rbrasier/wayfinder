import { describe, expect, it } from "vitest";
import { domainError } from "@wayfinder/domain";
import { statusForDomainError } from "./http-errors";

describe("statusForDomainError", () => {
  it.each([
    ["NOT_FOUND", 404],
    ["FORBIDDEN", 403],
    ["UNAUTHORIZED", 401],
    ["VALIDATION_FAILED", 400],
    ["CONFLICT", 409],
    ["ALREADY_EXISTS", 409],
    ["QUOTA_EXCEEDED", 429],
    ["INFRA_FAILURE", 500],
    ["AGENT_FAILED", 500],
    ["AI_PROVIDER_FAILED", 502],
  ] as const)("maps %s to %i", (code, status) => {
    expect(statusForDomainError(domainError(code, "message"))).toBe(status);
  });

  it("does not turn a refused export into a server error", () => {
    const refused = domainError("FORBIDDEN", "Only the flow's owner or an admin can export it.");

    expect(statusForDomainError(refused)).toBe(403);
  });
});
