import { describe, expect, it } from "vitest";
import { causeToMetadata } from "./error-metadata";

describe("causeToMetadata", () => {
  it("returns null for undefined cause", () => {
    expect(causeToMetadata(undefined)).toBeNull();
  });

  it("returns null for null cause", () => {
    expect(causeToMetadata(null)).toBeNull();
  });

  it("captures message and stack from Error instances", () => {
    const cause = new Error("column \"expert_role\" does not exist");
    const meta = causeToMetadata(cause);

    expect(meta).not.toBeNull();
    expect(meta!.message).toBe("column \"expert_role\" does not exist");
    expect(typeof meta!.stack).toBe("string");
    expect((meta!.stack as string).length).toBeGreaterThan(0);
  });

  it("captures Error name and any nested cause", () => {
    const root = new Error("root cause");
    const wrapping = new Error("wrapping");
    (wrapping as Error & { cause: unknown }).cause = root;

    const meta = causeToMetadata(wrapping);

    expect(meta!.message).toBe("wrapping");
    expect(meta!.cause).toBeTruthy();
    expect((meta!.cause as { message: string }).message).toBe("root cause");
  });

  it("stringifies non-Error values", () => {
    expect(causeToMetadata("a string cause")).toEqual({ value: "a string cause" });
    expect(causeToMetadata(42)).toEqual({ value: "42" });
    expect(causeToMetadata({ foo: "bar" })).toEqual({ value: '{"foo":"bar"}' });
  });

  it("includes the postgres error code when present", () => {
    const pgError = Object.assign(new Error("column does not exist"), {
      code: "42703",
      detail: "expert_role is missing",
    });

    const meta = causeToMetadata(pgError);

    expect(meta!.code).toBe("42703");
    expect(meta!.detail).toBe("expert_role is missing");
  });
});
