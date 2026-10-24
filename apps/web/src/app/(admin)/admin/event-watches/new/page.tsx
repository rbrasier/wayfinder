import { WatchEditor } from "@/components/event-watch/watch-editor";
import { requireAdminPath } from "@/lib/admin-page-guard";

export default async function NewEventWatchPage() {
  await requireAdminPath("/admin/event-watches/new");
  return <WatchEditor />;
}
