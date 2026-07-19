import { createServerHelpers } from "@/trpc/server";
import { AdminSkillsContent } from "./_content";

export default async function AdminSkillsPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.skill.list.prefetch({ includeArchived: true });
  return (
    <HydrateClient>
      <AdminSkillsContent />
    </HydrateClient>
  );
}
