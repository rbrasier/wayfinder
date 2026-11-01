import { createServerHelpers } from "@/trpc/server";
import { AdminValueDashboard } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminValuePage() {
  await requireAdminPath("/admin/dashboards/overview");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.analytics.value.prefetch({});
  return (
    <HydrateClient>
      <AdminValueDashboard />
    </HydrateClient>
  );
}
