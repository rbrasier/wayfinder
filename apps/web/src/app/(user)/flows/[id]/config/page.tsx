import { createServerHelpers } from "@/trpc/server";
import { TriggerInputsProvider } from "@/components/automation/trigger-inputs-provider";
import { FlowOwnerCanvasContent } from "./_content";

export default async function FlowOwnerCanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.flow.getCanvas.prefetch({ flowId: id });
  return (
    <HydrateClient>
      <TriggerInputsProvider flowId={id}>
        <FlowOwnerCanvasContent flowId={id} />
      </TriggerInputsProvider>
    </HydrateClient>
  );
}
