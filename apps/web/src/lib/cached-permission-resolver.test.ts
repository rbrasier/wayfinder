import { describe, expect, it, vi } from "vitest";
import { ok, err, type PermissionKey } from "@rbrasier/domain";
import { TtlCache } from "@rbrasier/adapters";
import { createCachedPermissionResolver } from "./cached-permission-resolver";

const permissions = (...keys: string[]) => new Set(keys as PermissionKey[]);

describe("createCachedPermissionResolver", () => {
  it("resolves effective permissions and serves a repeat lookup from cache", async () => {
    const loader = vi.fn(async () => ok(permissions("flows.read")));
    const cache = new TtlCache<Set<PermissionKey>>({ ttlMs: 1000, maxEntries: 10 });
    const resolve = createCachedPermissionResolver(loader, cache);

    const first = await resolve("user-1", false);
    const second = await resolve("user-1", false);

    expect(first.data).toEqual(permissions("flows.read"));
    expect(second.data).toEqual(permissions("flows.read"));
    // Repeat resolution avoids the role/permission round-trips (phase doc, wall #3).
    expect(loader).toHaveBeenCalledOnce();
  });

  it("keys the cache by admin status so role escalation is not served stale", async () => {
    const loader = vi.fn(async (_userId: string, isAdmin: boolean) =>
      ok(isAdmin ? permissions("*") : permissions("flows.read")),
    );
    const cache = new TtlCache<Set<PermissionKey>>({ ttlMs: 1000, maxEntries: 10 });
    const resolve = createCachedPermissionResolver(loader, cache);

    const asUser = await resolve("user-1", false);
    const asAdmin = await resolve("user-1", true);

    expect(asUser.data).toEqual(permissions("flows.read"));
    expect(asAdmin.data).toEqual(permissions("*"));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("does not cache an error result so a transient failure is retried", async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce(err({ code: "INFRA_FAILURE", message: "db down" }))
      .mockResolvedValueOnce(ok(permissions("flows.read")));
    const cache = new TtlCache<Set<PermissionKey>>({ ttlMs: 1000, maxEntries: 10 });
    const resolve = createCachedPermissionResolver(loader, cache);

    const first = await resolve("user-1", false);
    const second = await resolve("user-1", false);

    expect(first.error).toBeDefined();
    expect(second.data).toEqual(permissions("flows.read"));
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
