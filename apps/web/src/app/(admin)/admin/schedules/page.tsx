import { createServerHelpers } from "@/trpc/server";
import { AdminSchedulesContent } from "./_content";

export default async function AdminSchedulesPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.schedule.listRecentRuns.prefetch(undefined);
  return (
    <HydrateClient>
      <AdminSchedulesContent />
    </HydrateClient>
  );
}
