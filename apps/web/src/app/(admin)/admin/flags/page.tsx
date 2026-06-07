import { createServerHelpers } from "@/trpc/server";
import { AdminFlagsContent } from "./_content";

export default async function AdminFlagsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.featureFlag.list.prefetch();
  void trpc.role.list.prefetch();
  return (
    <HydrateClient>
      <AdminFlagsContent />
    </HydrateClient>
  );
}
