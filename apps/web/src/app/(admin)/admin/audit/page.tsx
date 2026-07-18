import { createServerHelpers } from "@/trpc/server";
import { AdminAuditContent } from "./_content";

export default async function AdminAuditPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.audit.search.prefetch({});
  return (
    <HydrateClient>
      <AdminAuditContent />
    </HydrateClient>
  );
}
