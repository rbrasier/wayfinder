import { createServerHelpers } from "@/trpc/server";
import { AdminGroupsContent } from "./_content";

export default async function AdminGroupsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.group.list.prefetch();
  void trpc.user.list.prefetch({});
  return (
    <HydrateClient>
      <AdminGroupsContent />
    </HydrateClient>
  );
}
