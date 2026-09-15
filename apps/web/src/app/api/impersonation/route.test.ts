import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createImpersonationTicket, IMPERSONATION_TTL_MS } from "@wayfinder/domain";
import { signImpersonationTicket, verifyImpersonationTicket } from "@wayfinder/adapters";

const SECRET = "test-secret-please-do-not-reuse";
const ADMIN = "11111111-1111-1111-1111-111111111111";
const TARGET = "22222222-2222-2222-2222-222222222222";

const USERS = [
  { id: ADMIN, name: "Ada Admin", email: "ada@example.com" },
  { id: TARGET, name: "Priya Raman", email: "priya@example.com" },
];

const auditRows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/container", () => ({
  getContainer: () => ({
    env: { BETTER_AUTH_SECRET: SECRET },
    services: {
      auditLogger: {
        log: async (payload: Record<string, unknown>) => {
          auditRows.push(payload);
          return { data: true };
        },
      },
    },
    repos: {
      users: { findById: async (id: string) => ({ data: USERS.find((u) => u.id === id) ?? null }) },
    },
  }),
}));

// withPrincipal owns resolution and the audit scope; these tests drive the
// routes' own behaviour, so the principal is supplied directly.
const principal = { current: { userId: ADMIN, isAdmin: true, impersonatorId: null as string | null } };
vi.mock("@/lib/with-principal", () => ({
  withPrincipal: async (_req: Request, handler: (p: unknown) => Promise<unknown>) =>
    handler(principal.current),
}));

const { POST: start } = await import("./start/route");
const { POST: stop } = await import("./stop/route");
const { POST: extend } = await import("./extend/route");

const liveTicket = () =>
  createImpersonationTicket({ targetUserId: TARGET, impersonatorId: ADMIN }).data!;

const requestWith = (body?: unknown, cookie?: string) =>
  new NextRequest("http://localhost:3000/api/impersonation", {
    method: "POST",
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: cookie ? { cookie: `wf.impersonation=${cookie}` } : {},
  });

const setCookieFor = (response: Response): string =>
  response.headers.get("set-cookie") ?? "";

beforeEach(() => {
  auditRows.length = 0;
  principal.current = { userId: ADMIN, isAdmin: true, impersonatorId: null };
});

describe("POST /api/impersonation/start", () => {
  it("emits a real Set-Cookie header carrying a verifiable ticket", async () => {
    const response = await start(requestWith({ userId: TARGET }));

    expect(response.status).toBe(200);
    const setCookie = setCookieFor(response);
    expect(setCookie).toContain("wf.impersonation=");

    const value = decodeURIComponent(setCookie.split("wf.impersonation=")[1]!.split(";")[0]!);
    const ticket = verifyImpersonationTicket(value, SECRET);
    expect(ticket?.targetUserId).toBe(TARGET);
    expect(ticket?.impersonatorId).toBe(ADMIN);
  });

  it("marks the cookie httpOnly and scoped to the whole site", async () => {
    const setCookie = setCookieFor(await start(requestWith({ userId: TARGET })));

    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie).toContain("Path=/");
  });

  it("refuses a non-admin", async () => {
    principal.current = { userId: TARGET, isAdmin: false, impersonatorId: null };

    const response = await start(requestWith({ userId: ADMIN }));

    expect(response.status).toBe(403);
    expect(setCookieFor(response)).not.toContain("wf.impersonation=ey");
  });

  it("refuses to nest a second simulation", async () => {
    principal.current = { userId: TARGET, isAdmin: false, impersonatorId: ADMIN };

    expect((await start(requestWith({ userId: ADMIN }))).status).toBe(403);
  });

  it("refuses the caller's own id", async () => {
    expect((await start(requestWith({ userId: ADMIN }))).status).toBe(400);
  });

  it("refuses a user who no longer exists", async () => {
    const response = await start(requestWith({ userId: "33333333-3333-3333-3333-333333333333" }));

    expect(response.status).toBe(404);
  });

  it("audits against the admin with no impersonated flag", async () => {
    await start(requestWith({ userId: TARGET }));

    expect(auditRows[0]).toMatchObject({
      actorId: ADMIN,
      action: "impersonation.started",
      resourceId: TARGET,
    });
    expect(auditRows[0]?.metadata).not.toHaveProperty("impersonated");
  });
});

describe("POST /api/impersonation/stop", () => {
  it("expires the cookie and audits against the admin", async () => {
    principal.current = { userId: TARGET, isAdmin: false, impersonatorId: ADMIN };

    const response = await stop(requestWith(undefined, signImpersonationTicket(liveTicket(), SECRET)));

    expect(setCookieFor(response)).toMatch(/wf\.impersonation=;|Max-Age=0/);
    expect(auditRows[0]).toMatchObject({ actorId: ADMIN, action: "impersonation.stopped" });
    expect(auditRows[0]?.metadata).not.toHaveProperty("impersonated");
  });

  it("is a no-op with no row written when nothing is being simulated", async () => {
    const response = await stop(requestWith());

    expect(response.status).toBe(200);
    expect(auditRows).toHaveLength(0);
    // The stray cookie is still cleared.
    expect(setCookieFor(response)).toContain("wf.impersonation=");
  });
});

describe("POST /api/impersonation/extend", () => {
  it("re-issues the cookie with a later expiry and preserves the start time", async () => {
    principal.current = { userId: TARGET, isAdmin: false, impersonatorId: ADMIN };
    const original = liveTicket();

    const response = await extend(
      requestWith(undefined, signImpersonationTicket(original, SECRET)),
    );

    expect(response.status).toBe(200);
    const value = decodeURIComponent(
      setCookieFor(response).split("wf.impersonation=")[1]!.split(";")[0]!,
    );
    const reissued = verifyImpersonationTicket(value, SECRET)!;
    expect(reissued.startedAt.getTime()).toBe(original.startedAt.getTime());
    expect(reissued.expiresAt.getTime()).toBeGreaterThanOrEqual(original.expiresAt.getTime());
    expect(auditRows[0]).toMatchObject({ actorId: ADMIN, action: "impersonation.extended" });
  });

  it("refuses when nothing is being simulated", async () => {
    expect((await extend(requestWith())).status).toBe(412);
  });

  it("refuses when the cookie does not verify", async () => {
    principal.current = { userId: TARGET, isAdmin: false, impersonatorId: ADMIN };

    expect((await extend(requestWith(undefined, "nonsense"))).status).toBe(412);
  });

  it("keeps the full TTL on the re-issued ticket", async () => {
    principal.current = { userId: TARGET, isAdmin: false, impersonatorId: ADMIN };

    const response = await extend(
      requestWith(undefined, signImpersonationTicket(liveTicket(), SECRET)),
    );
    const body = (await response.json()) as { expiresAt: string };

    expect(new Date(body.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      IMPERSONATION_TTL_MS - 5_000,
    );
  });
});
