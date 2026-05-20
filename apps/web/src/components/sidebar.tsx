"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  GitBranch,
  LayoutGrid,
  MessageSquare,
  Settings,
  Users,
} from "lucide-react";

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
}

const userNav: NavItem[] = [
  { href: "/chats", icon: MessageSquare, label: "Chats" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

const adminNav: NavItem[] = [
  { href: "/admin/flows", icon: GitBranch, label: "Flows" },
  { href: "/admin/sessions", icon: LayoutGrid, label: "Sessions" },
  { href: "/admin/users", icon: Users, label: "Users" },
  { href: "/admin/settings", icon: Settings, label: "Settings" },
];

interface AppSidebarProps {
  isAdmin?: boolean;
}

export function AppSidebar({ isAdmin = false }: AppSidebarProps) {
  const pathname = usePathname();

  if (pathname === "/admin/login") return null;

  const nav = isAdmin ? adminNav : userNav;
  const homeHref = isAdmin ? "/admin/flows" : "/chats";

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-14 shrink-0 flex-col border-r bg-white">
        <div className="flex h-14 items-center justify-center border-b">
          <Link href={homeHref} aria-label="Home">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
              W
            </div>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col items-center gap-1 py-3">
          {nav.map(({ href, icon: Icon, label }) => (
            <Link
              key={href}
              href={href}
              title={label}
              className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                isActive(href)
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
            </Link>
          ))}
        </nav>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex h-16 items-center justify-around border-t bg-white px-2">
        {nav.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={`flex flex-col items-center gap-0.5 px-3 py-2 text-[10px] font-medium transition-colors ${
              isActive(href) ? "text-primary" : "text-muted-foreground"
            }`}
          >
            <Icon className="h-5 w-5" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
