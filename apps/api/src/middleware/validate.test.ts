import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { validate } from "./validate.js";

const callbackSchema = z.object({
  nodeId: z.string().min(1),
  data: z.record(z.string(), z.unknown()).default({}),
});

const run = (source: Record<string, unknown>) => {
  const request = { body: source } as unknown as Request;
  const json = vi.fn();
  const response = { status: vi.fn(() => ({ json })) } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  validate(callbackSchema)(request, response, next);
  return { request, response, json, next };
};

describe("validate", () => {
  it("attaches the parsed payload, defaults applied, and calls next", () => {
    const { request, next } = run({ nodeId: "node-1" });

    expect(next).toHaveBeenCalledOnce();
    expect(request.validated).toEqual({ nodeId: "node-1", data: {} });
  });

  // API clients read this body; its shape must survive the zod major.
  it("answers 400 with VALIDATION_FAILED and per-field issues", () => {
    const { response, json, next } = run({ nodeId: "", data: "not-a-record" });

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0]?.[0] as {
      error: { code: string; issues: { formErrors: string[]; fieldErrors: Record<string, string[]> } };
    };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.issues.formErrors).toEqual([]);
    expect(Object.keys(body.error.issues.fieldErrors).sort()).toEqual(["data", "nodeId"]);
  });
});
