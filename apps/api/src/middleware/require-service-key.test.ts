import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { requireServiceKey } from "./require-service-key.js";

const KEY = "configured-service-key";

const run = (expectedKey: string | undefined, authorization: string | undefined) => {
  const request = { headers: authorization === undefined ? {} : { authorization } } as Request;
  const json = vi.fn();
  const response = { status: vi.fn().mockReturnValue({ json }) } as unknown as Response;
  const next = vi.fn() as NextFunction;
  requireServiceKey(expectedKey)(request, response, next);
  return { response, json, next };
};

describe("requireServiceKey", () => {
  it("calls next for the configured bearer key", () => {
    const { next, response } = run(KEY, `Bearer ${KEY}`);
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it("accepts the scheme case-insensitively", () => {
    const { next } = run(KEY, `bearer ${KEY}`);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["a different scheme", `Basic ${KEY}`],
    ["a bare key with no scheme", KEY],
    ["a key that differs", "Bearer configured-service-kez"],
    ["a prefix of the key", "Bearer configured"],
    ["the key with a suffix", `Bearer ${KEY}x`],
  ])("refuses %s with 401", (_label, authorization) => {
    const { next, response, json } = run(KEY, authorization);
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: { code: "UNAUTHORIZED", message: expect.any(String) } });
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("refuses every request when the key is %s, even an empty bearer", (_label, expectedKey) => {
    const { next, response } = run(expectedKey, "Bearer ");
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(401);
  });
});
