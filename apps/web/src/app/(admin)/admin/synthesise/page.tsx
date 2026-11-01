import { AdminSynthesiseContent } from "./_content";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function AdminSynthesisePage() {
  await requireAdminPath("/admin/synthesise");
  return <AdminSynthesiseContent />;
}
