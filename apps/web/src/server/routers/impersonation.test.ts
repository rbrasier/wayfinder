import { beforeEach, describe, expect, it, vi } from "vitest";
import { createImpersonationTicket, IMPERSONATION_TTL_MS } from "@wayfinder/domain";
import { signImpersonationTicket } from "@wayfinder/adapters";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { impersonationRouter } from "./impersonation";

const SECRET = "test-secret-please-do-not-reuse";
const ADMIN = "11111111-1111-1111-1111-111111111111";
const TARGET = "22222222-2222-2222-2222-222222222222";

// The cookie jar the router writes through, mocked so the router can be driven
// by createCallerFactory without a live request.
const jar: { value: string | null } = { value: null };
vi.mock("@/lib/impersonation-cookie-store", () => ({
  readImpersonationCookie: async () => jar.value,
  writeImpersonationCookie: async (value: string) => {
    jar.value = value;
  },
  clearImpersonationCookie: async () => {
    jar.value = null;
  },
}));

const testRouter = router({ impersonation: impersonationRouter });
const createCaller = createCallerFactory(testRouter);

const USERS = [
  { id: ADMIN, name: "Ada Admin", email: "ada@example.com", role: "Ops" },
  { id: TARGET, name: "Priya Raman", email: "priya@example.com", role: "Buyer" },
];

const auditRows: Array<Record<string, unknown>> = [];

const containerStub = (): Container =>
  ({
    env: { BETTER_AUTH_SECRET: SECRET },
    services: {
      errorLogger: { log: async () => undefined },
      auditLogger: {
        log: async (payload: Record<string, unknown>) => {
          auditRows.push(payload);
          return { data: true };
        },
      },
    },
    repos: {
      users: {
        findById: async (id: string) => ({ data: USERS.find((u) => u.id === id) ?? null }),
        search: async ({ query }: { query: string }) => ({
          data: USERS.filter(
            (u) =>
              u.name.toLowerCase().includes(query.toLowerCase()) ||
              u.email.toLowerCase().includes(query.toLowerCase()),
          ),
        }),
      },
    },
    useCases: { listUsers: { execute: async () => ({ data: USERS }) } },
  }) as unknown as Container;

const contextFor = (overrides: Partial<TrpcContext> = {}): TrpcContext => ({
  container: containerStub(),
  userId: ADMIN,
  isAdmin: true,
  impersonatorId: null,
  permissions: new Set(),
  headers: new Headers(),
  ...overrides,
});

// The context a request carries *while* a simulation is live: the principal is
// the target, the admin rides alongside.
const simulatingContext = (): TrpcContext =>
  contextFor({ userId: TARGET, isAdmin: false, impersonatorId: ADMIN });

beforeEach(() => {
  jar.value = null;
  auditRows.length = 0;
});

describe("impersonation.listTargets", () => {
  it("lists other users and never the calling admin", async () => {
    const caller = createCaller(contextFor());

    const targets = await caller.impersonation.listTargets({});

    expect(targets.map((t) => t.id)).toEqual([TARGET]);
  });

  it("filters server-side on name or email when a search is given", async () => {
    const caller = createCaller(contextFor());

    const targets = await caller.impersonation.listTargets({ search: "priya@" });

    expect(targets).toEqual([
      { id: TARGET, name: "Priya Raman", email: "priya@example.com", role: "Buyer" },
    ]);
  });

  it("refuses a non-admin caller", async () => {
    const caller = createCaller(contextFor({ isAdmin: false }));

    await expect(caller.impersonation.listTargets({})).rejects.toThrow(/Admin only/);
  });
});

describe("impersonation.start", () => {
  it("issues a ticket and writes the cookie", async () => {
    const caller = createCaller(contextFor());

    const result = await caller.impersonation.start({ userId: TARGET });

    expect(result.targetUserId).toBe(TARGET);
    expect(jar.value).not.toBeNull();
  });

  it("refuses a non-admin caller", async () => {
    const caller = createCaller(contextFor({ isAdmin: false }));

    await expect(caller.impersonation.start({ userId: TARGET })).rejects.toThrow(/Admin only/);
  });

  it("refuses the caller's own id", async () => {
    const caller = createCaller(contextFor());

    await expect(caller.impersonation.start({ userId: ADMIN })).rejects.toThrow(
      /cannot view as yourself/i,
    );
  });

  it("refuses a user who no longer exists", async () => {
    const caller = createCaller(contextFor());

    await expect(
      caller.impersonation.start({ userId: "33333333-3333-3333-3333-333333333333" }),
    ).rejects.toThrow(/no longer exists/);
  });

  it("refuses to nest a second simulation", async () => {
    const caller = createCaller(contextFor());
    await caller.impersonation.start({ userId: TARGET });

    await expect(caller.impersonation.start({ userId: TARGET })).rejects.toThrow(
      /already viewing as/,
    );
  });

  it("audits against the admin, with no impersonated flag", async () => {
    const caller = createCaller(contextFor());

    await caller.impersonation.start({ userId: TARGET });

    expect(auditRows[0]).toMatchObject({
      actorId: ADMIN,
      action: "impersonation.started",
      resourceType: "user",
      resourceId: TARGET,
      metadata: { impersonatorId: ADMIN, targetUserId: TARGET },
    });
    expect(auditRows[0]?.metadata).not.toHaveProperty("impersonated");
  });
});

describe("impersonation.stop", () => {
  const liveCookie = () =>
    signImpersonationTicket(
      createImpersonationTicket({ targetUserId: TARGET, impersonatorId: ADMIN }).data!,
      SECRET,
    );

  it("clears the cookie and audits against the admin", async () => {
    jar.value = liveCookie();
    const caller = createCaller(simulatingContext());

    const result = await caller.impersonation.stop();

    expect(result.stopped).toBe(true);
    expect(jar.value).toBeNull();
    expect(auditRows[0]).toMatchObject({
      actorId: ADMIN,
      action: "impersonation.stopped",
      resourceId: TARGET,
    });
    expect(auditRows[0]?.metadata).not.toHaveProperty("impersonated");
  });

  it("is a no-op with no row written when nothing is being simulated", async () => {
    const caller = createCaller(contextFor());

    const result = await caller.impersonation.stop();

    expect(result.stopped).toBe(false);
    expect(auditRows).toHaveLength(0);
  });

  it("clears a stray cookie even when the context is not simulating", async () => {
    jar.value = "left-over-nonsense";
    const caller = createCaller(contextFor());

    await caller.impersonation.stop();

    expect(jar.value).toBeNull();
  });
});

describe("impersonation.extend", () => {
  it("re-issues the ticket and audits the extension", async () => {
    const original = createImpersonationTicket({
      targetUserId: TARGET,
      impersonatorId: ADMIN,
    }).data!;
    jar.value = signImpersonationTicket(original, SECRET);
    const caller = createCaller(simulatingContext());

    const result = await caller.impersonation.extend();

    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(original.expiresAt.getTime());
    expect(auditRows[0]).toMatchObject({ actorId: ADMIN, action: "impersonation.extended" });
    expect(auditRows[0]?.metadata).not.toHaveProperty("impersonated");
  });

  it("refuses when nothing is being simulated", async () => {
    const caller = createCaller(contextFor());

    await expect(caller.impersonation.extend()).rejects.toThrow(/not viewing as another user/);
  });
});

describe("impersonation.current", () => {
  it("returns null for an unauthenticated caller rather than throwing", async () => {
    const caller = createCaller(contextFor({ userId: null, isAdmin: false }));

    await expect(caller.impersonation.current()).resolves.toBeNull();
  });

  it("returns null when the caller is not simulating", async () => {
    const caller = createCaller(contextFor());

    await expect(caller.impersonation.current()).resolves.toBeNull();
  });

  it("names the target and the minutes left, never the impersonator", async () => {
    jar.value = signImpersonationTicket(
      createImpersonationTicket({ targetUserId: TARGET, impersonatorId: ADMIN }).data!,
      SECRET,
    );
    const caller = createCaller(simulatingContext());

    const current = await caller.impersonation.current();

    expect(current).toEqual({
      targetName: "Priya Raman",
      targetEmail: "priya@example.com",
      minutesRemaining: IMPERSONATION_TTL_MS / 60_000,
    });
    expect(JSON.stringify(current)).not.toContain(ADMIN);
  });
});
