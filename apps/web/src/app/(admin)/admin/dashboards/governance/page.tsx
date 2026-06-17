import { createServerHelpers } from "@/trpc/server";
import { AdminGovernanceDashboard } from "./_content";

export default async function AdminGovernancePage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.governance.dashboard.prefetch(undefined);
  void trpc.governance.budgets.list.prefetch();
  void trpc.user.list.prefetch({});
  return (
    <HydrateClient>
      <AdminGovernanceDashboard />
    </HydrateClient>
  );
}
