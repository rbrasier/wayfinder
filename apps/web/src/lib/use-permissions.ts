"use client";

import type { PermissionKey } from "@rbrasier/domain";
import { trpc } from "@/trpc/client";

export interface PermissionState {
  readonly isLoading: boolean;
  readonly isAdmin: boolean;
  has: (key: PermissionKey) => boolean;
}

/**
 * Client-side mirror of the server's effective permissions (UX only — every gate
 * is also enforced server-side, ADR-021). Admins always pass.
 */
export const usePermissions = (): PermissionState => {
  const meQuery = trpc.user.me.useQuery();
  const isAdmin = meQuery.data?.isAdmin ?? false;
  const permissions = new Set<PermissionKey>(
    (meQuery.data?.permissions ?? []) as PermissionKey[],
  );

  return {
    isLoading: meQuery.isLoading,
    isAdmin,
    has: (key) => isAdmin || permissions.has(key),
  };
};
