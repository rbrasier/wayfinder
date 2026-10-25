import { AppSettingsContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AppSettingsPage() {
  const viewer = await requireAdminPath("/admin/settings");
  // Decided on the server so the Global-only cards are in the first render
  // rather than appearing once the client loads the viewer.
  return <AppSettingsContent isGlobalAdmin={viewer.isAdmin} />;
}
