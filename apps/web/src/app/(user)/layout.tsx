import type { ReactNode } from "react";
import { AppSidebar } from "@/components/sidebar";
import { SidebarProvider } from "@/components/sidebar-context";

export default function UserLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex h-screen overflow-hidden">
        <AppSidebar isAdmin={false} />
        <div className="flex flex-1 flex-col overflow-hidden bg-[#f7f6f3]">
          {children}
        </div>
      </div>
    </SidebarProvider>
  );
}
