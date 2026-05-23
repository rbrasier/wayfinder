import { createServerHelpers } from "@/trpc/server";
import { FlowOwnerCanvasContent } from "./_content";

export default async function FlowOwnerCanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.flow.getCanvas.prefetch({ flowId: id });
  return (
    <HydrateClient>
      <FlowOwnerCanvasContent flowId={id} />
    </HydrateClient>
  );
}
