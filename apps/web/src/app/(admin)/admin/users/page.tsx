import { createServerHelpers } from "@/trpc/server";
import { AdminUsersContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminUsersPage() {
  const viewer = await requireAdminPath("/admin/users");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.user.list.prefetch({});
  void trpc.role.list.prefetch();
  return (
    <HydrateClient>
      <AdminUsersContent viewerIsGlobalAdmin={viewer.isAdmin} />
    </HydrateClient>
  );
}
