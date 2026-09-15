import { createServerHelpers } from "@/trpc/server";
import { AdminValueDashboard } from "./_content";

export default async function AdminValuePage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.analytics.value.prefetch({});
  return (
    <HydrateClient>
      <AdminValueDashboard />
    </HydrateClient>
  );
}
