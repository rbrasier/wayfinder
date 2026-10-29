import { createServerHelpers } from "@/trpc/server";
import { EventWatchRunsContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function EventWatchRunsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPath("/admin/event-watches");
  const { id } = await params;
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.eventWatch.runs.prefetch({ id });
  return (
    <HydrateClient>
      <EventWatchRunsContent watchId={id} />
    </HydrateClient>
  );
}
