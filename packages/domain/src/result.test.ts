import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr } from "./result";
import { domainError } from "./errors/domain-error";

describe("Result", () => {
  it("ok wraps a value as { data }", () => {
    const r = ok(42);
    expect(r.data).toBe(42);
    expect(r.error).toBeUndefined();
    expect(isOk(r)).toBe(true);
  });

  it("err wraps a domain error", () => {
    const r = err(domainError("NOT_FOUND", "missing"));
    expect(r.error?.code).toBe("NOT_FOUND");
    expect(r.data).toBeUndefined();
    expect(isErr(r)).toBe(true);
  });
});
