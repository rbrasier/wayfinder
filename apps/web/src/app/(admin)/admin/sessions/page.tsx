import { createServerHelpers } from "@/trpc/server";
import { AdminSessionsContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminSessionsPage() {
  await requireAdminPath("/admin/sessions");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.session.listAllPage.prefetchInfinite({});
  return (
    <HydrateClient>
      <AdminSessionsContent />
    </HydrateClient>
  );
}
