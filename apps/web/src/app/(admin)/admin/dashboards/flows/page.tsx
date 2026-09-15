import { createServerHelpers } from "@/trpc/server";
import { AdminFlowHealth } from "./_content";

export default async function AdminFlowHealthPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.analytics.flowDeepDive.prefetch(undefined);
  return (
    <HydrateClient>
      <AdminFlowHealth />
    </HydrateClient>
  );
}
