import { createServerHelpers } from "@/trpc/server";
import { AdminAuditContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminAuditPage() {
  await requireAdminPath("/admin/audit");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.audit.search.prefetch({});
  return (
    <HydrateClient>
      <AdminAuditContent />
    </HydrateClient>
  );
}
