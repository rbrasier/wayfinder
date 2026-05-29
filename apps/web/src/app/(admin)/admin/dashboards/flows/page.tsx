import { createServerHelpers } from "@/trpc/server";
import { AdminFlowDeepDive } from "./_content";

export default async function AdminFlowDeepDivePage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.analytics.flowDeepDive.prefetch(undefined);
  return (
    <HydrateClient>
      <AdminFlowDeepDive />
    </HydrateClient>
  );
}
