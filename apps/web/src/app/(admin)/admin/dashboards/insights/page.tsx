import { createServerHelpers } from "@/trpc/server";
import { AdminFlowInsights } from "./_content";

export default async function AdminFlowInsightsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.analytics.flowDeepDive.prefetch(undefined);
  return (
    <HydrateClient>
      <AdminFlowInsights />
    </HydrateClient>
  );
}
