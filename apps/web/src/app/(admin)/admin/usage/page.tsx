import { createServerHelpers } from "@/trpc/server";
import { AdminUsageContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminUsagePage() {
  await requireAdminPath("/admin/usage");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.usage.summary.prefetch(undefined);
  void trpc.governance.budgets.list.prefetch();
  void trpc.user.list.prefetch({});
  return (
    <HydrateClient>
      <AdminUsageContent />
    </HydrateClient>
  );
}
