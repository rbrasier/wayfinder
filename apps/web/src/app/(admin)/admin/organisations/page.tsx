import { createServerHelpers } from "@/trpc/server";
import { AdminOrganisationsContent } from "./_content";

export default async function AdminOrganisationsPage() {
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
