import { createServerHelpers } from "@/trpc/server";
import { KnowledgeContent } from "./_content";

export default async function KnowledgePage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.session.listPublishedFlows.prefetch();
  void trpc.feedback.list.prefetch({ status: "pending", limit: 50, offset: 0 });
  return (
    <HydrateClient>
      <KnowledgeContent />
    </HydrateClient>
  );
}
