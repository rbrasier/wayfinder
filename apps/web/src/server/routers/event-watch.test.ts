import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok, type PermissionKey } from "@wayfinder/domain";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { eventWatchRouter } from "./event-watch";

const createCaller = createCallerFactory(router({ eventWatch: eventWatchRouter }));

const makeContainer = (flagOn = true) =>
  ({
    services: { errorLogger: { log: async () => undefined } },
    useCases: {
      isFeatureEnabled: { execute: vi.fn().mockResolvedValue(ok(flagOn)) },
      countWatchesNeedingAttention: { execute: vi.fn().mockResolvedValue(ok(2)) },
      testEventWatch: {
        execute: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "The API answered HTTP 401."))),
      },
    },
  }) as unknown as Container;

const caller = (container: Container, isAdmin: boolean, permissions: PermissionKey[] = []) =>
  createCaller({
    container,
    userId: "admin-1",
    authSessionId: null,
    isAdmin,
    impersonatorId: null,
    impersonationCookie: null,
    permissions: new Set(permissions),
    headers: new Headers(),
  } satisfies TrpcContext);

describe("eventWatch router", () => {
  it("is closed to anyone without technical admin access", async () => {
    await expect(caller(makeContainer(), false).eventWatch.countNeedingAttention()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller(makeContainer(), false, ["admin:users", "admin:oversight"]).eventWatch.countNeedingAttention(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("answers a Technical Admin whenever the flag is switched on, whoever it is scoped to (ADR-066 §5)", async () => {
    await expect(
      caller(makeContainer(), false, ["admin:technical"]).eventWatch.countNeedingAttention(),
    ).resolves.toBe(2);
  });

  it("is closed to a Technical Admin while the event_watch flag is off", async () => {
    await expect(
      caller(makeContainer(false), false, ["admin:technical"]).eventWatch.countNeedingAttention(),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Event Watch is switched off." });
  });

  it("is closed while the event_watch flag is off", async () => {
    await expect(caller(makeContainer(false), true).eventWatch.countNeedingAttention()).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Event Watch is switched off.",
    });
  });

  it("answers an admin with the flag on", async () => {
    await expect(caller(makeContainer(), true).eventWatch.countNeedingAttention()).resolves.toBe(2);
  });

  it("returns a failed test as an answer the editor can show, not an error", async () => {
    const result = await caller(makeContainer(), true).eventWatch.test({
      connection: { url: "https://api.example.gov.au", method: "GET", authType: "none", apiKeyPlacement: null },
      secret: undefined,
    });

    expect(result).toEqual({ ok: false, message: "The API answered HTTP 401." });
  });
});
