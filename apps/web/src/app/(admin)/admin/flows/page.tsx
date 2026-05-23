import { createServerHelpers } from "@/trpc/server";
import { AdminFlowsContent } from "./_content";

export default async function AdminFlowsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.flow.list.prefetch();
  void trpc.user.list.prefetch({});
  return (
    <HydrateClient>
      <AdminFlowsContent />
    </HydrateClient>
  );
}
