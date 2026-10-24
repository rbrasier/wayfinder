import type { Container } from "@/lib/container";

// Feature flags that switch an admin surface on and off (ADR-066 §5). Their role
// scoping (ADR-022, ADR-063 §8) narrows who may *author* with the capability; on
// the admin screen an area key holder only needs the flag switched on, as a
// Global Admin always has. Never use this for flow-authoring checks.
export const ADMIN_SURFACE_FLAGS = ["skills", "mcp", "event_watch"] as const;

export type AdminSurfaceFlag = (typeof ADMIN_SURFACE_FLAGS)[number];

export const isAdminSurfaceEnabled = async (
  container: Container,
  flag: AdminSurfaceFlag,
): Promise<boolean> => {
  const result = await container.useCases.isFeatureEnabled.execute(flag);
  return !result.error && result.data === true;
};
