import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/sidebar";
import { LoginNoticeGate } from "@/components/login-notice/login-notice-gate";
import { SetupWizardMount } from "@/components/onboarding/setup-wizard-mount";
import { SidebarProvider } from "@/components/sidebar-context";
import { createServerHelpers } from "@/trpc/server";
import { resolveServerPrincipal } from "@/lib/server-principal";
import { canOpenAdminArea, hasAnyAdminArea } from "@/lib/admin-areas";
import { createServerTrpcContext } from "@/server/server-context";

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

  // Open to Global Admins and to anyone holding an admin area key (ADR-066).
  // Everyone else (including flow owners who followed a stale /admin link) is
  // sent to their own workspace. Each page then checks its own area.
  const viewer = await createServerTrpcContext();
  if (!hasAnyAdminArea(viewer)) {
    redirect("/");
  }

  const { trpc, HydrateClient } = await createServerHelpers();

  void trpc.user.me.prefetch();
  void trpc.settings.getBranding.prefetch();
  void trpc.settings.getLoginNoticeStatus.prefetch();
  void trpc.usage.myUsage.prefetch();
  // Prefetch only what this viewer may read, or the hydrated cache carries a
  // FORBIDDEN error into the page.
  if (canOpenAdminArea(viewer, "oversight")) void trpc.flow.list.prefetch();
  if (canOpenAdminArea(viewer, "users") || canOpenAdminArea(viewer, "oversight")) {
    void trpc.user.list.prefetch({});
  }

  return (
    <SidebarProvider>
      <HydrateClient>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AppSidebar isAdmin={true} />
          <div className="flex flex-1 flex-col overflow-hidden bg-[#faf9f7]">
            {children}
          </div>
          {/* First-run setup configures auth and deployment, so it is Global-only. */}
          {principal.isAdmin && <SetupWizardMount />}
          {/* No organisation or welcome prompts here, so no SignInPromptsProvider:
              the notice gate stands alone (ADR-061 §5). */}
          <LoginNoticeGate />
        </div>
      </HydrateClient>
    </SidebarProvider>
  );
}
