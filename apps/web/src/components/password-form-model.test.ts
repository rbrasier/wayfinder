import { describe, it, expect } from "vitest";
import { MINIMUM_PASSWORD_LENGTH, validatePasswordPair } from "./password-form-model";

describe("validatePasswordPair", () => {
  it("accepts a long enough pair that matches", () => {
    expect(validatePasswordPair("correct-horse", "correct-horse")).toBeNull();
  });

  it("rejects a password below the minimum length", () => {
    expect(validatePasswordPair("short", "short")).toMatch(/at least 8 characters/i);
  });

  it("rejects a pair that does not match", () => {
    expect(validatePasswordPair("correct-horse", "correct-zebra")).toMatch(/do not match/i);
  });

  it("reports the length problem first when both are wrong", () => {
    expect(validatePasswordPair("short", "other")).toMatch(/at least 8 characters/i);
  });

  it("rejects an empty password rather than treating it as a matching pair", () => {
    expect(validatePasswordPair("", "")).toMatch(/at least 8 characters/i);
  });

  it("counts a password exactly at the minimum as long enough", () => {
    const exact = "a".repeat(MINIMUM_PASSWORD_LENGTH);
    expect(validatePasswordPair(exact, exact)).toBeNull();
  });

  it("treats trailing whitespace as part of the password", () => {
    expect(validatePasswordPair("password ", "password")).toMatch(/do not match/i);
  });
});
