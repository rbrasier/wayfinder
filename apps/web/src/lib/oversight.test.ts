import { ok, type PermissionKey } from "@rbrasier/domain";
import { describe, expect, it, vi } from "vitest";
import type { Container } from "./container";
import { resolveCanOversee } from "./oversight";

// The REST routes resolve a session, not a tRPC context, so they look up the
// caller's effective permissions to decide oversight (ADR-066 §4).

const containerGranting = (permissions: PermissionKey[]) => {
  const resolveEffectivePermissions = vi.fn().mockResolvedValue(ok(new Set(permissions)));
  return { container: { resolveEffectivePermissions } as unknown as Container, resolveEffectivePermissions };
};

describe("resolveCanOversee", () => {
  it("is true for a Global Admin without looking up permissions", async () => {
    const { container, resolveEffectivePermissions } = containerGranting([]);

    await expect(resolveCanOversee(container, { userId: "u1", isAdmin: true })).resolves.toBe(true);
    expect(resolveEffectivePermissions).not.toHaveBeenCalled();
  });

  it("is true for a holder of admin:oversight", async () => {
    const { container } = containerGranting(["admin:oversight"]);

    await expect(resolveCanOversee(container, { userId: "u1", isAdmin: false })).resolves.toBe(true);
  });

  it("is false for a Technical Admin", async () => {
    const { container } = containerGranting(["admin:technical"]);

    await expect(resolveCanOversee(container, { userId: "u1", isAdmin: false })).resolves.toBe(false);
  });

  it("is false when the permission lookup fails", async () => {
    const container = {
      resolveEffectivePermissions: async () => ({ error: { code: "INFRA_FAILURE", message: "down" } }),
    } as unknown as Container;

    await expect(resolveCanOversee(container, { userId: "u1", isAdmin: false })).resolves.toBe(false);
  });
});
