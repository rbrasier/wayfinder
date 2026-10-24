import { createServerHelpers } from "@/trpc/server";
import { AdminSkillsContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminSkillsPage() {
  await requireAdminPath("/admin/skills");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.skill.list.prefetch({ includeArchived: true });
  return (
    <HydrateClient>
      <AdminSkillsContent />
    </HydrateClient>
  );
}
