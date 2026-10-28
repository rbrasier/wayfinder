import { createServerHelpers } from "@/trpc/server";
import { AdminMcpServersContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminMcpServersPage() {
  await requireAdminPath("/admin/mcp-servers");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.mcpServer.list.prefetch({ includeDisabled: true });
  return (
    <HydrateClient>
      <AdminMcpServersContent />
    </HydrateClient>
  );
}
