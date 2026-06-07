import type { PermissionKey } from "@rbrasier/domain";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { Container } from "@/lib/container";
import {
  createCallerFactory,
  permissionProcedure,
  router,
  type TrpcContext,
} from "./trpc";

const testRouter = router({
  publishGuarded: permissionProcedure("workflow:publish_to_everyone").query(() => "ok"),
});

const createCaller = createCallerFactory(testRouter);

const containerStub = {
  services: { errorLogger: { log: async () => undefined } },
} as unknown as Container;

const contextWith = (overrides: Partial<TrpcContext>): TrpcContext => ({
  container: containerStub,
  userId: "user-1",
  isAdmin: false,
  permissions: new Set<PermissionKey>(),
  headers: new Headers(),
  ...overrides,
});

describe("permissionProcedure", () => {
  it("allows a caller that holds the required permission", async () => {
    const caller = createCaller(
      contextWith({ permissions: new Set<PermissionKey>(["workflow:publish_to_everyone"]) }),
    );
    await expect(caller.publishGuarded()).resolves.toBe("ok");
  });

  it("rejects a caller without the permission with FORBIDDEN", async () => {
    const caller = createCaller(contextWith({ permissions: new Set() }));
    await expect(caller.publishGuarded()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("always allows admins regardless of their permission set", async () => {
    const caller = createCaller(contextWith({ isAdmin: true, permissions: new Set() }));
    await expect(caller.publishGuarded()).resolves.toBe("ok");
  });

  it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    const caller = createCaller(contextWith({ userId: null }));
    await expect(caller.publishGuarded()).rejects.toBeInstanceOf(TRPCError);
    await expect(caller.publishGuarded()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
