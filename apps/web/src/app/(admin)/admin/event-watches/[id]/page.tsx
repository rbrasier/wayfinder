import { createServerHelpers } from "@/trpc/server";
import { EditEventWatchContent } from "./_content";

export default async function EditEventWatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.eventWatch.get.prefetch({ id });
  return (
    <HydrateClient>
      <EditEventWatchContent watchId={id} />
    </HydrateClient>
  );
}
