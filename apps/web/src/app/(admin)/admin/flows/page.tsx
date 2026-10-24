import { createServerHelpers } from "@/trpc/server";
import { AdminFlowsContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminFlowsPage() {
  await requireAdminPath("/admin/flows");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.flow.list.prefetch();
  void trpc.user.list.prefetch({});
  return (
    <HydrateClient>
      <AdminFlowsContent />
    </HydrateClient>
  );
}
