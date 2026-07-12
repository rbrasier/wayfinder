import { describe, expect, it } from "vitest";
import { accessError, authorizeSessionAccess } from "./session-access";
import type { Container } from "./container";

const SESSION = { id: "s1", userId: "owner", flowId: "f1", status: "active" };
const FLOW = { id: "f1", ownerUserId: "owner", visibility: "private" };

interface FakeOptions {
  sessionFound?: boolean;
  getSessionError?: boolean;
  access?: { error?: unknown; data?: { canSend: boolean; readOnly: boolean } };
}

const buildContainer = (options: FakeOptions): Container => {
  const {
    sessionFound = true,
    getSessionError = false,
    access = { data: { canSend: true, readOnly: false } },
  } = options;
  return {
    useCases: {
      getSession: {
        execute: async () =>
          getSessionError
            ? { error: { code: "INFRA_FAILURE", message: "boom" } }
            : { data: sessionFound ? { session: SESSION, flow: FLOW } : null },
      },
      resolveSessionAccess: {
        execute: async () => access,
      },
    },
    repos: {
      approvals: { listBySession: async () => ({ data: [] }) },
      users: { findById: async () => ({ data: { email: "a@b.c" } }) },
    },
  } as unknown as Container;
};

describe("authorizeSessionAccess", () => {
  it("authorises a member with send access", async () => {
    const result = await authorizeSessionAccess(buildContainer({}), "s1", "u1", false, {
      requireSend: true,
      allowApprover: false,
    });
    expect(result).toEqual({ authorized: true, readOnly: false });
  });

  it("rejects a non-member (resolveSessionAccess returns FORBIDDEN)", async () => {
    const container = buildContainer({ access: { error: { code: "FORBIDDEN", message: "no" } } });
    const result = await authorizeSessionAccess(container, "s1", "attacker", false, {
      requireSend: false,
      allowApprover: true,
    });
    expect(result).toEqual({ authorized: false, status: 403 });
  });

  it("rejects a read-only participant on a write action", async () => {
    const container = buildContainer({ access: { data: { canSend: false, readOnly: true } } });
    const result = await authorizeSessionAccess(container, "s1", "viewer", false, {
      requireSend: true,
      allowApprover: false,
    });
    expect(result).toEqual({ authorized: false, status: 403 });
  });

  it("allows a read-only participant on a read action", async () => {
    const container = buildContainer({ access: { data: { canSend: false, readOnly: true } } });
    const result = await authorizeSessionAccess(container, "s1", "viewer", false, {
      requireSend: false,
      allowApprover: true,
    });
    expect(result).toEqual({ authorized: true, readOnly: true });
  });

  it("returns 404 when the session does not exist", async () => {
    const result = await authorizeSessionAccess(buildContainer({ sessionFound: false }), "s1", "u1", false, {
      requireSend: false,
      allowApprover: false,
    });
    expect(result).toEqual({ authorized: false, status: 404 });
  });

  it("returns 500 when the session load errors", async () => {
    const result = await authorizeSessionAccess(buildContainer({ getSessionError: true }), "s1", "u1", false, {
      requireSend: false,
      allowApprover: false,
    });
    expect(result).toEqual({ authorized: false, status: 500 });
  });
});

describe("accessError", () => {
  it("maps status codes to messages", () => {
    expect(accessError(404)).toBe("Session not found");
    expect(accessError(403)).toBe("Forbidden");
    expect(accessError(500)).toBe("Server error");
  });
});
