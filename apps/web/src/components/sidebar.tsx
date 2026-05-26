"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle,
  BarChart2,
  Flag,
  GitBranch,
  LayoutGrid,
  Menu,
  MessageSquare,
  Settings,
  ShieldOff,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { useSidebar } from "@/components/sidebar-context";
import { trpc } from "@/trpc/client";

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
}

const userNav: NavItem[] = [
  { href: "/chats", icon: MessageSquare, label: "My Chats" },
  { href: "/flows", icon: GitBranch, label: "Flows" },
  { href: "/settings", icon: Settings, label: "Settings" },
];

const adminNav: NavItem[] = [
  { href: "/admin/sessions", icon: LayoutGrid, label: "All Sessions" },
  { href: "/admin/flows", icon: GitBranch, label: "Flows" },
  { href: "/admin/users", icon: Users, label: "Users" },
  { href: "/admin/usage", icon: BarChart2, label: "Usage" },
  { href: "/admin/flags", icon: Flag, label: "Flags" },
  { href: "/admin/errors", icon: AlertCircle, label: "Errors" },
  { href: "/admin/settings", icon: Settings, label: "Settings" },
];

interface AppSidebarProps {
  isAdmin?: boolean;
}

export function AppSidebar({ isAdmin = false }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { mobileOpen, openMobile, closeMobile } = useSidebar();

  const userQuery = trpc.user.me.useQuery();
  const sessionsQuery = trpc.session.list.useQuery(undefined, {
    enabled: !isAdmin,
  });
  const publishedFlowsQuery = trpc.session.listPublishedFlows.useQuery(undefined, {
    enabled: !isAdmin,
  });

  if (pathname === "/admin/login") return null;

  const nav = isAdmin ? adminNav : userNav;
  const homeHref = isAdmin ? "/admin/flows" : "/chats";

  const recentChats = isAdmin
    ? []
    : (sessionsQuery.data ?? [])
        .filter((session) => session.status !== "abandoned")
        .slice(0, 8)
        .map((session) => {
          const flow = publishedFlowsQuery.data?.find((f) => f.id === session.flowId);
          return {
            id: session.id,
            label: session.title ?? flow?.name ?? "Untitled chat",
            icon: flow?.icon ?? "💬",
            status: session.status,
          };
        });

  const user = userQuery.data;
  const displayName = user?.name ?? user?.email ?? "";
  const initials = displayName
    .split(" ")
    .map((n: string) => n[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || (user?.email?.slice(0, 2).toUpperCase() ?? "?");

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const navContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-[9px] border-b border-[#dedad2] px-[18px] pb-[14px] pt-[16px]">
        <Link href={homeHref} onClick={closeMobile}>
          <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[#3a5fd9] text-[11px] font-bold text-white">
            W
          </div>
        </Link>
        <span className="text-[14px] font-bold tracking-[-0.3px] text-[#1a1814]">Wayfinder</span>
      </div>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col gap-[2px] overflow-y-auto px-[10px] py-[12px]">
        {nav.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            onClick={closeMobile}
            className={`flex items-center gap-[9px] rounded-[8px] px-[10px] py-[8px] text-[13.5px] transition-colors ${
              isActive(href)
                ? "bg-[#eef1fc] font-medium text-[#3a5fd9]"
                : "text-[#5a5650] hover:bg-[#efede8] hover:text-[#1a1814]"
            }`}
          >
            <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
              <Icon className="h-[15px] w-[15px]" />
            </span>
            {label}
          </Link>
        ))}

        {recentChats.length > 0 && (
          <>
            <hr className="my-[10px] border-[#dedad2]" />
            <div className="px-[10px] pb-[6px] pt-[4px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#918d87]">
              Recent Chats
            </div>
            {recentChats.map((chat) => (
              <Link
                key={chat.id}
                href={`/chats/${chat.id}`}
                onClick={closeMobile}
                className="flex items-center gap-[9px] rounded-[8px] px-[10px] py-[7px] text-[13px] text-[#5a5650] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
              >
                <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[5px] bg-[#eef1fc] text-[11px]">
                  {chat.icon}
                </span>
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{chat.label}</span>
                <span
                  aria-label={chat.status === "complete" ? "Complete" : "In progress"}
                  className={`shrink-0 rounded-full px-[7px] py-[1px] text-[9.5px] font-semibold ${
                    chat.status === "complete"
                      ? "bg-[#eaf6f0] text-[#2e9e6a]"
                      : "bg-[#eef1fc] text-[#3a5fd9]"
                  }`}
                >
                  {chat.status === "complete" ? "Done" : "Live"}
                </span>
              </Link>
            ))}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-[#dedad2] px-[10px] py-[12px]">
        {isAdmin && (
          <button
            onClick={() => router.push("/chats")}
            className="mb-[10px] flex w-full items-center gap-[7px] rounded-[8px] border border-[#e8b87c] bg-[#fdf3e3] px-[10px] py-[8px] text-[12px] font-medium text-[#c17a1a] transition-colors hover:border-[#d4a265] hover:bg-[#fae8ce]"
          >
            <ShieldOff className="h-[13px] w-[13px] shrink-0" />
            <span>Exit admin mode</span>
          </button>
        )}
        {!isAdmin && user?.isAdmin && (
          <button
            onClick={() => router.push("/admin/sessions")}
            className="mb-[10px] flex w-full items-center gap-[7px] rounded-[8px] border border-[#c5d0f7] bg-[#eef1fc] px-[10px] py-[8px] text-[12px] font-medium text-[#3a5fd9] transition-colors hover:border-[#a8b9f0] hover:bg-[#dde5fb]"
          >
            <ShieldCheck className="h-[13px] w-[13px] shrink-0" />
            <span>Enter admin mode</span>
          </button>
        )}
        {user && (
          <div className="flex items-center gap-[8px] rounded-[8px] px-[10px] py-[8px] hover:bg-[#efede8]">
            <div className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-[#3a5fd9] text-[11px] font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-[#1a1814]">{displayName}</div>
              {user.email && (
                <div className="truncate text-[11px] text-[#918d87]">{user.email}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: 220px text sidebar */}
      <aside className="hidden h-screen w-[220px] shrink-0 flex-col border-r border-[#dedad2] bg-white md:flex">
        {navContent}
      </aside>

      {/* Mobile: hamburger triggers the drawer managed by parent context */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-[rgba(20,18,15,0.35)]"
            onClick={closeMobile}
          />
          {/* Drawer */}
          <div className="fixed bottom-0 left-0 top-0 z-50 flex w-[220px] flex-col bg-white shadow-[4px_0_20px_rgba(0,0,0,.12)]">
            {/* Drawer header with close button */}
            <div className="flex items-center justify-between border-b border-[#dedad2] px-[14px] py-[14px] pb-[12px]">
              <div className="flex items-center gap-[9px]">
                <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[#3a5fd9] text-[11px] font-bold text-white">
                  W
                </div>
                <span className="text-[14px] font-bold tracking-[-0.2px] text-[#1a1814]">Wayfinder</span>
              </div>
              <button
                onClick={closeMobile}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#dedad2] text-[#918d87] hover:bg-[#efede8]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {/* Reuse nav + footer */}
            <nav className="flex flex-1 flex-col gap-[2px] overflow-y-auto px-[10px] py-[12px]">
              {nav.map(({ href, icon: Icon, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={closeMobile}
                  className={`flex items-center gap-[9px] rounded-[8px] px-[10px] py-[8px] text-[13.5px] transition-colors ${
                    isActive(href)
                      ? "bg-[#eef1fc] font-medium text-[#3a5fd9]"
                      : "text-[#5a5650] hover:bg-[#efede8] hover:text-[#1a1814]"
                  }`}
                >
                  <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
                    <Icon className="h-[15px] w-[15px]" />
                  </span>
                  {label}
                </Link>
              ))}
              {recentChats.length > 0 && (
                <>
                  <hr className="my-[10px] border-[#dedad2]" />
                  <div className="px-[10px] pb-[6px] pt-[4px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#918d87]">
                    Recent Chats
                  </div>
                  {recentChats.map((chat) => (
                    <Link
                      key={chat.id}
                      href={`/chats/${chat.id}`}
                      onClick={closeMobile}
                      className="flex items-center gap-[9px] rounded-[8px] px-[10px] py-[7px] text-[13px] text-[#5a5650] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
                    >
                      <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[5px] bg-[#eef1fc] text-[11px]">
                        {chat.icon}
                      </span>
                      <span className="overflow-hidden text-ellipsis whitespace-nowrap">{chat.label}</span>
                    </Link>
                  ))}
                </>
              )}
            </nav>
            <div className="border-t border-[#dedad2] px-[10px] py-[12px]">
              {isAdmin && (
                <button
                  onClick={() => { closeMobile(); router.push("/chats"); }}
                  className="mb-[10px] flex w-full items-center gap-[7px] rounded-[8px] border border-[#e8b87c] bg-[#fdf3e3] px-[10px] py-[8px] text-[12px] font-medium text-[#c17a1a] transition-colors hover:border-[#d4a265] hover:bg-[#fae8ce]"
                >
                  <ShieldOff className="h-[13px] w-[13px] shrink-0" />
                  <span>Exit admin mode</span>
                </button>
              )}
              {!isAdmin && user?.isAdmin && (
                <button
                  onClick={() => { closeMobile(); router.push("/admin/sessions"); }}
                  className="mb-[10px] flex w-full items-center gap-[7px] rounded-[8px] border border-[#c5d0f7] bg-[#eef1fc] px-[10px] py-[8px] text-[12px] font-medium text-[#3a5fd9] transition-colors hover:border-[#a8b9f0] hover:bg-[#dde5fb]"
                >
                  <ShieldCheck className="h-[13px] w-[13px] shrink-0" />
                  <span>Enter admin mode</span>
                </button>
              )}
              {user && (
                <div className="flex items-center gap-[8px] rounded-[8px] px-[10px] py-[8px]">
                  <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#3a5fd9] text-[10px] font-bold text-white">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-[#1a1814]">{displayName}</div>
                    {user.email && (
                      <div className="truncate text-[11px] text-[#918d87]">{user.email}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Mobile hamburger trigger — rendered inside the layout's content column via the mobile header */}
      <button
        className="fixed left-4 top-[14px] z-30 flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#dedad2] bg-white shadow-[0_1px_3px_rgba(0,0,0,.06)] md:hidden"
        onClick={openMobile}
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4 text-[#5a5650]" />
      </button>
    </>
  );
}
