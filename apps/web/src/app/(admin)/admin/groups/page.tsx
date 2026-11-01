import { createServerHelpers } from "@/trpc/server";
import { AdminGroupsContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminGroupsPage() {
  await requireAdminPath("/admin/groups");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.group.list.prefetch();
  void trpc.user.list.prefetch({});
  return (
    <HydrateClient>
      <AdminGroupsContent />
    </HydrateClient>
  );
}
