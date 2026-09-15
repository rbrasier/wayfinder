import type { PermissionKey } from "@wayfinder/domain";
import { describe, expect, it, vi } from "vitest";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { flowRouter } from "./flow";

const testRouter = router({ flow: flowRouter });
const createCaller = createCallerFactory(testRouter);

const FLOW_ID = "55555555-5555-5555-5555-555555555555";

// The router hands identity to the use-case, which owns the owner-or-admin rule
// (ADR-049 §9). These tests assert the hand-off, and that a refusal from the
// use-case reaches the caller as FORBIDDEN rather than being swallowed.
const containerWith = (duplicateFlow: { execute: ReturnType<typeof vi.fn> }): Container =>
  ({
    services: { errorLogger: { log: async () => undefined } },
    useCases: { duplicateFlow },
  }) as unknown as Container;

const contextFor = (container: Container, overrides: Partial<TrpcContext> = {}): TrpcContext => ({
  container,
  userId: "user-1",
  isAdmin: false,
  permissions: new Set<PermissionKey>(),
  headers: new Headers(),
  ...overrides,
});

describe("flow.duplicate", () => {
  it("passes the caller's id and admin flag to the use-case", async () => {
    const execute = vi.fn().mockResolvedValue({ data: { id: "flow-copy", name: "Flow (copy)" } });
    const caller = createCaller(contextFor(containerWith({ execute })));

    await caller.flow.duplicate({ flowId: FLOW_ID });

    expect(execute).toHaveBeenCalledWith({
      flowId: FLOW_ID,
      requestedByUserId: "user-1",
      isAdmin: false,
    });
  });

  it("marks an admin caller as one, so they may duplicate a flow they do not own", async () => {
    const execute = vi.fn().mockResolvedValue({ data: { id: "flow-copy", name: "Flow (copy)" } });
    const caller = createCaller(
      contextFor(containerWith({ execute }), { userId: "admin-1", isAdmin: true }),
    );

    await caller.flow.duplicate({ flowId: FLOW_ID });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ isAdmin: true }));
  });

  it("surfaces the use-case's refusal as FORBIDDEN", async () => {
    const execute = vi.fn().mockResolvedValue({
      error: { code: "FORBIDDEN", message: "Only the flow's owner or an admin can duplicate it." },
    });
    const caller = createCaller(contextFor(containerWith({ execute })));

    await expect(caller.flow.duplicate({ flowId: FLOW_ID })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("surfaces a missing flow as NOT_FOUND", async () => {
    const execute = vi.fn().mockResolvedValue({
      error: { code: "NOT_FOUND", message: "Flow not found." },
    });
    const caller = createCaller(contextFor(containerWith({ execute })));

    await expect(caller.flow.duplicate({ flowId: FLOW_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects a flowId that is not a uuid before reaching the use-case", async () => {
    const execute = vi.fn();
    const caller = createCaller(contextFor(containerWith({ execute })));

    await expect(caller.flow.duplicate({ flowId: "not-a-uuid" })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});
