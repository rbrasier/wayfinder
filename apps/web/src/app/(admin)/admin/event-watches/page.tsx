import { createServerHelpers } from "@/trpc/server";
import { AdminEventWatchesContent } from "./_content";

export default async function AdminEventWatchesPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.eventWatch.list.prefetch(undefined);
  return (
    <HydrateClient>
      <AdminEventWatchesContent />
    </HydrateClient>
  );
}
