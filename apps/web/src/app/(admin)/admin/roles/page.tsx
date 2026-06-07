import { createServerHelpers } from "@/trpc/server";
import { AdminRolesContent } from "./_content";

export default async function AdminRolesPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.role.list.prefetch();
  void trpc.user.list.prefetch({});
  return (
    <HydrateClient>
      <AdminRolesContent />
    </HydrateClient>
  );
}
