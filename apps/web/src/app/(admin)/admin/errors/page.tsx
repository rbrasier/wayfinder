import { createServerHelpers } from "@/trpc/server";
import { AdminErrorsContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminErrorsPage() {
  await requireAdminPath("/admin/errors");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.error.listGrouped.prefetch({});
  return (
    <HydrateClient>
      <AdminErrorsContent />
    </HydrateClient>
  );
}
