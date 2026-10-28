import { createServerHelpers } from "@/trpc/server";
import { AdminRolesContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminRolesPage() {
  await requireAdminPath("/admin/roles");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.role.list.prefetch();
  void trpc.user.list.prefetch({});
  return (
    <HydrateClient>
      <AdminRolesContent />
    </HydrateClient>
  );
}
