import { AppSettingsContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AppSettingsPage() {
  await requireAdminPath("/admin/settings");
  return <AppSettingsContent />;
}
