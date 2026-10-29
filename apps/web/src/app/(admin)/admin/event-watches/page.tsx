import { createServerHelpers } from "@/trpc/server";
import { AdminEventWatchesContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminEventWatchesPage() {
  await requireAdminPath("/admin/event-watches");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.eventWatch.list.prefetch(undefined);
  return (
    <HydrateClient>
      <AdminEventWatchesContent />
    </HydrateClient>
  );
}
