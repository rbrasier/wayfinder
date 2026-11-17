import type { PermissionKey } from "@wayfinder/domain";
import { trpc } from "@/trpc/client";

export interface FlowHeaderGates {
  canManageTriggers: boolean;
  testRunsEnabled: boolean;
  portabilityEnabled: boolean;
}

// Which header actions this caller sees. UX only — each action's procedure or
// route enforces the same rule server-side. Triggers follow the "Start flows via
// webhook" permission (ADR-064 §3); Test and Export follow their alpha-3 flags.
export function useFlowHeaderGates(): FlowHeaderGates {
  const me = trpc.user.me.useQuery().data;
  const flags = trpc.featureFlag.isEnabledForMe;
  const permissions = (me?.permissions ?? []) as PermissionKey[];
  return {
    canManageTriggers: (me?.isAdmin ?? false) || permissions.includes("flow:webhook_trigger"),
    testRunsEnabled: flags.useQuery({ key: "flow_test_runs" }).data ?? false,
    portabilityEnabled: flags.useQuery({ key: "flow_portability" }).data ?? false,
  };
}
