import { createServerHelpers } from "@/trpc/server";
import { ApprovalsContent } from "./_content";

export default async function ApprovalsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.approval.listPending.prefetch();
  return (
    <HydrateClient>
      <ApprovalsContent />
    </HydrateClient>
  );
}
