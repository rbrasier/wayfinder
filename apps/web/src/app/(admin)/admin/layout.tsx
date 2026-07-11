import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/sidebar";
import { HelpMenu } from "@/components/help-menu";
import { SidebarProvider } from "@/components/sidebar-context";
import { createServerHelpers } from "@/trpc/server";
import { getContainer } from "@/lib/container";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore
    .getAll()
    .find((c) => c.name.endsWith(".session_token") || c.name === "better-auth.session_token");

  if (!sessionCookie?.value) {
    redirect("/login");
  }

  const session = await getContainer().resolveSession(sessionCookie.value);
  if (!session) {
    redirect("/login?expired=true");
  }

  // The admin section is admin-only. Non-admins (including flow owners who
  // followed a stale /admin link) are sent to their own workspace.
  if (!session.isAdmin) {
    redirect("/");
  }

  const { trpc, HydrateClient } = await createServerHelpers();

  void trpc.user.me.prefetch();
  void trpc.flow.list.prefetch();
  void trpc.user.list.prefetch({});
  void trpc.usage.myUsage.prefetch();

  return (
    <SidebarProvider>
      <HydrateClient>
        <div className="flex h-screen overflow-hidden">
          <AppSidebar isAdmin={true} />
          <div className="flex flex-1 flex-col overflow-hidden bg-[#f7f6f3]">
            {children}
          </div>
          <HelpMenu />
        </div>
      </HydrateClient>
    </SidebarProvider>
  );
}
