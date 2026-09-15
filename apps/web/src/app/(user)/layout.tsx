import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/sidebar";
import { OrganisationSignInGate } from "@/components/organisation/organisation-sign-in-gate";
import { SignInPromptsProvider } from "@/components/layout/sign-in-prompts";
import { SidebarProvider } from "@/components/sidebar-context";
import { WelcomeTourGate } from "@/components/tour/welcome-tour-gate";
import { createServerHelpers } from "@/trpc/server";
import { getContainer } from "@/lib/container";

export default async function UserLayout({ children }: { children: ReactNode }) {
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

  const { trpc, HydrateClient } = await createServerHelpers();

  void trpc.user.me.prefetch();
  void trpc.session.list.prefetch();
  void trpc.session.listPublishedFlows.prefetch();
  void trpc.usage.myUsage.prefetch();
  void trpc.organisation.signInState.prefetch();

  return (
    <SidebarProvider>
      <HydrateClient>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AppSidebar isAdmin={false} />
          <div className="flex flex-1 flex-col overflow-hidden bg-[#faf9f7]">
            {children}
          </div>
          <SignInPromptsProvider>
            <OrganisationSignInGate />
            <WelcomeTourGate />
          </SignInPromptsProvider>
        </div>
      </HydrateClient>
    </SidebarProvider>
  );
}
