import { redirect } from "next/navigation";
import { requireAdminPath } from "@/lib/admin-page-guard";

// The flow canvas editor now lives at a single canonical route. This admin path
// is kept only so existing links and bookmarks resolve; it forwards to the one
// editor, which self-adapts to the viewer's permissions.
export default async function AdminFlowRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPath("/admin/flows");
  const { id } = await params;
  redirect(`/flows/${id}/config`);
}
