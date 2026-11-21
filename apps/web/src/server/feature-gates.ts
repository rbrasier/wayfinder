import { TRPCError } from "@trpc/server";
import type { ExperimentalFeatureFlag } from "@wayfinder/application";
import type { Container } from "@/lib/container";
import { authenticatedProcedure } from "./trpc";

interface FeatureCaller {
  container: Container;
  userId: string;
  isAdmin: boolean;
}

const FEATURE_NAMES: Record<ExperimentalFeatureFlag, string> = {
  flow_memory: "Flow memory",
  flow_test_runs: "Test runs",
  view_as_user: "View as user",
  flow_portability: "Flow export, import and duplicate",
  lookup_sources: "Lookup sources",
};

// The caller's own reading of an experimental flag, honouring its role scoping
// (ADR-022). A failed lookup reads as off: these capabilities default off, so
// failing closed matches what a fresh install shows.
export const isFeatureEnabledForCaller = async (
  caller: FeatureCaller,
  key: ExperimentalFeatureFlag,
): Promise<boolean> => {
  const result = await caller.container.useCases.isFeatureEnabledForUser.execute(
    caller.userId,
    key,
    caller.isAdmin,
  );
  return !result.error && result.data === true;
};

export const requireFeatureForCaller = async (
  caller: FeatureCaller,
  key: ExperimentalFeatureFlag,
): Promise<void> => {
  if (await isFeatureEnabledForCaller(caller, key)) return;
  throw new TRPCError({ code: "FORBIDDEN", message: `${FEATURE_NAMES[key]} is switched off.` });
};

// A tRPC procedure open only to authenticated callers for whom the flag is on.
// Used for routers whose whole surface is the experimental capability.
export const featureProcedure = (key: ExperimentalFeatureFlag) =>
  authenticatedProcedure.use(async ({ ctx, next }) => {
    await requireFeatureForCaller(ctx, key);
    return next();
  });
