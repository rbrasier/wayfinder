import { redirect } from "next/navigation";
import { createServerTrpcContext } from "@/server/server-context";
import { canOpenAdminPath, firstAdminHref, type AdminViewer } from "./admin-areas";

// Each admin page calls this with its own path (ADR-066 §4). The admin layout
// cannot do it: it does not re-render on navigation between sibling pages.
// Hiding the page is UX only — the page's procedures enforce the same area.
// Returns the viewer so a page can shape its first render without waiting on
// the client's `user.me`.
export const requireAdminPath = async (pathname: string): Promise<AdminViewer> => {
  const viewer = await createServerTrpcContext();
  if (canOpenAdminPath(viewer, pathname)) return viewer;
  redirect(firstAdminHref(viewer) ?? "/");
};
