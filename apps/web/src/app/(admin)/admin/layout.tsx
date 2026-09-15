import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/sidebar";
import { SetupWizardMount } from "@/components/onboarding/setup-wizard-mount";
import { SidebarProvider } from "@/components/sidebar-context";
import { createServerHelpers } from "@/trpc/server";
import { resolveServerPrincipal } from "@/lib/server-principal";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { hasSessionCookie, principal } = await resolveServerPrincipal();

  if (!hasSessionCookie) {
    redirect("/login");
  }
  if (!principal) {
    redirect("/login?expired=true");
  }

  // A simulated session is never an admin session, whoever is being simulated:
  // deriving this from the target's is_admin would make the rule conditional and
  // let an admin take admin actions from inside a simulation (ADR-059 §3a).
  if (principal.impersonatorId) {
    redirect("/chats");
  }

  // The admin section is admin-only. Non-admins (including flow owners who
  // followed a stale /admin link) are sent to their own workspace.
  if (!principal.isAdmin) {
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
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AppSidebar isAdmin={true} />
          <div className="flex flex-1 flex-col overflow-hidden bg-[#faf9f7]">
            {children}
          </div>
          <SetupWizardMount />
        </div>
      </HydrateClient>
    </SidebarProvider>
  );
}
