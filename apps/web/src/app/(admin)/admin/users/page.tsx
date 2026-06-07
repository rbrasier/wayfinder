import { createServerHelpers } from "@/trpc/server";
import { AdminUsersContent } from "./_content";

export default async function AdminUsersPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.user.list.prefetch({});
  void trpc.role.list.prefetch();
  return (
    <HydrateClient>
      <AdminUsersContent />
    </HydrateClient>
  );
}
