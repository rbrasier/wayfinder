import { createServerHelpers } from "@/trpc/server";
import { AdminFlagsContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminFlagsPage() {
  await requireAdminPath("/admin/flags");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.featureFlag.list.prefetch();
  void trpc.role.list.prefetch();
  return (
    <HydrateClient>
      <AdminFlagsContent />
    </HydrateClient>
  );
}
