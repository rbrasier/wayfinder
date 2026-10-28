import { createServerHelpers } from "@/trpc/server";
import { AdminSchedulesContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminSchedulesPage() {
  await requireAdminPath("/admin/schedules");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.schedule.listRecentRuns.prefetch(undefined);
  return (
    <HydrateClient>
      <AdminSchedulesContent />
    </HydrateClient>
  );
}
