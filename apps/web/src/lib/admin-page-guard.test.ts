import type { PermissionKey } from "@rbrasier/domain";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: (href: string): never => {
    throw new Error(`redirect:${href}`);
  },
  viewer: { isAdmin: false, permissions: new Set<string>() },
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/server-context", () => ({ createServerTrpcContext: async () => mocks.viewer }));

const { requireAdminPath } = await import("./admin-page-guard");

const signInAs = (permissions: PermissionKey[], isAdmin = false) => {
  mocks.viewer.isAdmin = isAdmin;
  mocks.viewer.permissions = new Set(permissions);
};

describe("requireAdminPath (ADR-066 §4)", () => {
  it("lets a Technical Admin stay on Configuration", async () => {
    signInAs(["admin:technical"]);

    await expect(requireAdminPath("/admin/settings")).resolves.toMatchObject({ isAdmin: false });
  });

  it("sends a Technical Admin who opens Users to their own first area", async () => {
    signInAs(["admin:technical"]);

    await expect(requireAdminPath("/admin/users")).rejects.toThrow("redirect:/admin/settings");
  });

  it("sends a User Admin away from the Global-only Roles screen", async () => {
    signInAs(["admin:users"]);

    await expect(requireAdminPath("/admin/roles")).rejects.toThrow("redirect:/admin/users");
  });

  it("sends someone with no admin area to their workspace", async () => {
    signInAs([]);

    await expect(requireAdminPath("/admin/settings")).rejects.toThrow("redirect:/");
  });

  it("lets a Global Admin open any screen", async () => {
    signInAs([], true);

    await expect(requireAdminPath("/admin/roles")).resolves.toMatchObject({ isAdmin: true });
  });
});
