import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok } from "@rbrasier/domain";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { eventWatchRouter } from "./event-watch";

const createCaller = createCallerFactory(router({ eventWatch: eventWatchRouter }));

const makeContainer = (flagOn = true) =>
  ({
    services: { errorLogger: { log: async () => undefined } },
    useCases: {
      isFeatureEnabledForUser: { execute: vi.fn().mockResolvedValue(ok(flagOn)) },
      countWatchesNeedingAttention: { execute: vi.fn().mockResolvedValue(ok(2)) },
      testEventWatch: {
        execute: vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "The API answered HTTP 401."))),
      },
    },
  }) as unknown as Container;

const caller = (container: Container, isAdmin: boolean) =>
  createCaller({
    container,
    userId: "admin-1",
    authSessionId: null,
    isAdmin,
    permissions: new Set(),
    headers: new Headers(),
  } satisfies TrpcContext);

describe("eventWatch router", () => {
  it("is for admins only", async () => {
    await expect(caller(makeContainer(), false).eventWatch.countNeedingAttention()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
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
