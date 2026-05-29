import { createServerHelpers } from "@/trpc/server";
import { AdminOverviewDashboard } from "./_content";

export default async function AdminOverviewPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.analytics.overview.prefetch(undefined);
  return (
    <HydrateClient>
      <AdminOverviewDashboard />
    </HydrateClient>
  );
}
