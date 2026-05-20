import type { ReactNode } from "react";
import { AppSidebar } from "@/components/sidebar";

export default function UserLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar isAdmin={false} />
      <div className="flex flex-1 flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}
