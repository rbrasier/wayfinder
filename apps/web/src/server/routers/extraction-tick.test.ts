import { describe, expect, it, vi } from "vitest";
import { ok } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { extractionRouter } from "./extraction";

const createCaller = createCallerFactory(router({ extraction: extractionRouter }));

const run = { id: "run-1", flowId: "flow-1", status: "running" };

const makeContainer = (overrides: { advanceOne?: ReturnType<typeof vi.fn> } = {}) => {
  const advanceOne = overrides.advanceOne ?? vi.fn().mockResolvedValue(ok(undefined));
  const container = {
    services: { errorLogger: { log: async () => undefined } },
    repos: {
      extractionRuns: { getRun: vi.fn().mockResolvedValue(ok(run)) },
    },
    useCases: {
      isFeatureEnabledForUser: { execute: vi.fn().mockResolvedValue(ok(true)) },
      advanceBatchRuns: { advanceOne },
      getFlowCanvas: { execute: vi.fn().mockResolvedValue(ok(null)) },
    },
  } as unknown as Container;
  return { container, advanceOne };
};

const contextWith = (container: Container, isAdmin = true): TrpcContext => ({
  container,
  userId: "user-1",
  isAdmin,
  permissions: new Set(["extraction:run" as never]),
  headers: new Headers(),
});

describe("extraction.tick", () => {
  it("advances the named run", async () => {
    const { container, advanceOne } = makeContainer();

    const result = await createCaller(contextWith(container)).extraction.tick({
      runId: "00000000-0000-4000-8000-000000000001",
    });

    expect(result).toEqual({ ok: true });
    expect(advanceOne).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
  });

  it("refuses a caller who cannot edit the run's flow", async () => {
    const { container, advanceOne } = makeContainer();

    await expect(
      createCaller(contextWith(container, false)).extraction.tick({
        runId: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow(/cannot control this run/i);
    expect(advanceOne).not.toHaveBeenCalled();
  });
});
