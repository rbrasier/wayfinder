import { createServerHelpers } from "@/trpc/server";
import { EditEventWatchContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function EditEventWatchPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPath("/admin/event-watches");
  const { id } = await params;
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.eventWatch.get.prefetch({ id });
  return (
    <HydrateClient>
      <EditEventWatchContent watchId={id} />
    </HydrateClient>
  );
}
