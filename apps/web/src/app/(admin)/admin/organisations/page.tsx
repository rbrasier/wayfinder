import { createServerHelpers } from "@/trpc/server";
import { AdminOrganisationsContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminOrganisationsPage() {
  await requireAdminPath("/admin/organisations");
  const { trpc, HydrateClient } = await createServerHelpers();
  void trpc.organisation.list.prefetch();
  void trpc.organisation.getResolution.prefetch();
  void trpc.user.list.prefetch({});
  return (
    <HydrateClient>
      <AdminOrganisationsContent />
    </HydrateClient>
  );
}
