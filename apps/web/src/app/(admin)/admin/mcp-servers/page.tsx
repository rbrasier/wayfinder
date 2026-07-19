import { createServerHelpers } from "@/trpc/server";
import { AdminMcpServersContent } from "./_content";

export default async function AdminMcpServersPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.mcpServer.list.prefetch({ includeDisabled: true });
  return (
    <HydrateClient>
      <AdminMcpServersContent />
    </HydrateClient>
  );
}
