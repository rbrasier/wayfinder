import type { PermissionKey } from "@wayfinder/domain";
import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { Container } from "@/lib/container";
import {
  adminCallerOf,
  anyPermissionProcedure,
  canOversee,
  createCallerFactory,
  permissionProcedure,
  router,
  type TrpcContext,
} from "./trpc";

const testRouter = router({
  publishGuarded: permissionProcedure("workflow:publish_to_everyone").query(() => "ok"),
  sharedRead: anyPermissionProcedure(["admin:users", "admin:oversight"]).query(() => "ok"),
});

const createCaller = createCallerFactory(testRouter);

const containerStub = {
  services: { errorLogger: { log: async () => undefined } },
} as unknown as Container;

const contextWith = (overrides: Partial<TrpcContext>): TrpcContext => ({
  container: containerStub,
  userId: "user-1",
  authSessionId: null,
  isAdmin: false,
  impersonatorId: null,
  impersonationCookie: null,
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

describe("anyPermissionProcedure", () => {
  it("allows a caller holding any one of the listed permissions", async () => {
    const userAdmin = createCaller(contextWith({ permissions: new Set<PermissionKey>(["admin:users"]) }));
    const oversight = createCaller(contextWith({ permissions: new Set<PermissionKey>(["admin:oversight"]) }));

    await expect(userAdmin.sharedRead()).resolves.toBe("ok");
    await expect(oversight.sharedRead()).resolves.toBe("ok");
  });

  it("rejects a caller holding none of them with FORBIDDEN", async () => {
    const caller = createCaller(contextWith({ permissions: new Set<PermissionKey>(["admin:technical"]) }));

    await expect(caller.sharedRead()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("always allows admins", async () => {
    const caller = createCaller(contextWith({ isAdmin: true }));

    await expect(caller.sharedRead()).resolves.toBe("ok");
  });

  it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    const caller = createCaller(contextWith({ userId: null, permissions: new Set<PermissionKey>(["admin:users"]) }));

    await expect(caller.sharedRead()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("canOversee", () => {
  it("is true for a Global Admin and for an admin:oversight holder", () => {
    expect(canOversee(contextWith({ isAdmin: true }))).toBe(true);
    expect(canOversee(contextWith({ permissions: new Set<PermissionKey>(["admin:oversight"]) }))).toBe(true);
  });

  it("is false for a Technical Admin or User Admin", () => {
    expect(canOversee(contextWith({ permissions: new Set<PermissionKey>(["admin:technical", "admin:users"]) }))).toBe(false);
  });
});

describe("adminCallerOf", () => {
  it("carries the caller's admin status and id into the guarded use cases", () => {
    expect(adminCallerOf(contextWith({ isAdmin: false, userId: "user-7" }))).toEqual({
      isAdmin: false,
      userId: "user-7",
    });
  });
});
