import { describe, expect, it } from "vitest";
import { createImpersonationTicket, IMPERSONATION_TTL_MS } from "@wayfinder/domain";
import { signImpersonationTicket } from "@wayfinder/adapters";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { impersonationRouter } from "./impersonation";

const SECRET = "test-secret-please-do-not-reuse";
const ADMIN = "11111111-1111-1111-1111-111111111111";
const TARGET = "22222222-2222-2222-2222-222222222222";

const testRouter = router({ impersonation: impersonationRouter });
const createCaller = createCallerFactory(testRouter);

const USERS = [
  { id: ADMIN, name: "Ada Admin", email: "ada@example.com", role: "Ops" },
  { id: TARGET, name: "Priya Raman", email: "priya@example.com", role: "Buyer" },
];

const containerStub = (): Container =>
  ({
    env: { BETTER_AUTH_SECRET: SECRET },
    services: { errorLogger: { log: async () => undefined } },
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
  impersonationCookie: null,
  permissions: new Set(),
  headers: new Headers(),
  ...overrides,
});

const liveCookie = () =>
  signImpersonationTicket(
    createImpersonationTicket({ targetUserId: TARGET, impersonatorId: ADMIN }).data!,
    SECRET,
  );

// The context a request carries *while* a simulation is live: the principal is
// the target, the admin rides alongside.
const simulatingContext = (): TrpcContext =>
  contextFor({
    userId: TARGET,
    isAdmin: false,
    impersonatorId: ADMIN,
    impersonationCookie: liveCookie(),
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

describe("impersonation.current", () => {
  it("returns null for an unauthenticated caller rather than throwing", async () => {
    const caller = createCaller(contextFor({ userId: null, isAdmin: false }));

    await expect(caller.impersonation.current()).resolves.toBeNull();
  });

  it("returns null when the caller is not simulating", async () => {
    const caller = createCaller(contextFor());

    await expect(caller.impersonation.current()).resolves.toBeNull();
  });

  it("returns null when the cookie does not verify", async () => {
    const caller = createCaller(
      contextFor({ userId: TARGET, impersonatorId: ADMIN, impersonationCookie: "nonsense" }),
    );

    await expect(caller.impersonation.current()).resolves.toBeNull();
  });

  it("names the target and the minutes left, never the impersonator", async () => {
    const caller = createCaller(simulatingContext());

    const current = await caller.impersonation.current();

    expect(current).toEqual({
      targetName: "Priya Raman",
      targetEmail: "priya@example.com",
      minutesRemaining: IMPERSONATION_TTL_MS / 60_000,
    });
    expect(JSON.stringify(current)).not.toContain(ADMIN);
  });

  // The procedure must not reach for `cookies()`: under httpBatchStreamLink the
  // body runs after the response has been handed back.
  it("reads the ticket from the context, not from a request API", async () => {
    const caller = createCaller(simulatingContext());

    await expect(caller.impersonation.current()).resolves.not.toBeNull();
  });
});
