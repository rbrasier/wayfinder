import { ok, type PermissionKey } from "@wayfinder/domain";
import { describe, expect, it, vi } from "vitest";
import type { Container } from "@/lib/container";
import { createCallerFactory, router, type TrpcContext } from "../trpc";
import { flowVersionRouter } from "./flow-version";
import { sessionRouter } from "./session";

// ADR-066 §4 (maintainer decision at build): an admin:oversight holder opens and
// edits other people's chats and flows exactly as a Global Admin does from All
// Chats and All Flows. Technical and User Admins do not.

const createCaller = createCallerFactory(router({ flowVersion: flowVersionRouter, session: sessionRouter }));

const FLOW_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";

const makeContainer = () => {
  const listFlowVersions = { execute: vi.fn().mockResolvedValue(ok([])) };
  const updateSession = vi.fn().mockResolvedValue(ok({ id: SESSION_ID }));
  const container = {
    services: {
      errorLogger: { log: async () => undefined },
      sessionEvents: { publish: async () => undefined },
    },
    repos: {
      users: { findManyByIds: async () => ok([]) },
      sessions: { update: updateSession },
    },
    useCases: {
      getFlowCanvas: {
        execute: async () => ok({ flow: { id: FLOW_ID, ownerUserId: "someone-else", permissions: [] } }),
      },
      listFlowVersions,
      getSession: {
        execute: async () => ok({ session: { id: SESSION_ID, userId: "someone-else" }, flow: { id: FLOW_ID } }),
      },
    },
  } as unknown as Container;
  return { container, listFlowVersions, updateSession };
};

const callerWith = (container: Container, permissions: PermissionKey[], isAdmin = false) =>
  createCaller({
    container,
    userId: "viewer",
    authSessionId: null,
    impersonatorId: null,
    impersonationCookie: null,
    isAdmin,
    permissions: new Set(permissions),
    headers: new Headers(),
  } satisfies TrpcContext);

describe("oversight over other people's flows", () => {
  it("lets an oversight holder open the history of a flow they do not own", async () => {
    const { container, listFlowVersions } = makeContainer();

    await callerWith(container, ["admin:oversight"]).flowVersion.list({ flowId: FLOW_ID });

    expect(listFlowVersions.execute).toHaveBeenCalledWith(FLOW_ID);
  });

  it("refuses a Technical Admin or User Admin the same flow", async () => {
    const { container } = makeContainer();

    await expect(
      callerWith(container, ["admin:technical", "admin:users"]).flowVersion.list({ flowId: FLOW_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("oversight over other people's chats", () => {
  it("lets an oversight holder rename a chat they do not own", async () => {
    const { container, updateSession } = makeContainer();

    await callerWith(container, ["admin:oversight"]).session.rename({ sessionId: SESSION_ID, title: "Renamed" });

    expect(updateSession).toHaveBeenCalledWith(SESSION_ID, { title: "Renamed" });
  });

  it("refuses a Technical Admin renaming someone else's chat", async () => {
    const { container, updateSession } = makeContainer();

    await expect(
      callerWith(container, ["admin:technical"]).session.rename({ sessionId: SESSION_ID, title: "Renamed" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(updateSession).not.toHaveBeenCalled();
  });
});
