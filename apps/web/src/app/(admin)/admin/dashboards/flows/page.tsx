import { createServerHelpers } from "@/trpc/server";
import { AdminFlowHealth } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminFlowHealthPage() {
  await requireAdminPath("/admin/dashboards/flows");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.analytics.flowDeepDive.prefetch(undefined);
  return (
    <HydrateClient>
      <AdminFlowHealth />
    </HydrateClient>
  );
}
