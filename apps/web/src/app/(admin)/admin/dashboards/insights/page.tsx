import { createServerHelpers } from "@/trpc/server";
import { AdminFlowInsights } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminFlowInsightsPage() {
  await requireAdminPath("/admin/dashboards/insights");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.analytics.flowDeepDive.prefetch(undefined);
  return (
    <HydrateClient>
      <AdminFlowInsights />
    </HydrateClient>
  );
}
