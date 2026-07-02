"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart2,
  BookOpen,
  ChevronDown,
  Clock,
  Flag,
  GitBranch,
  LogOut,
  Menu,
  MessageSquare,
  PieChart,
  Plug,
  Settings,
  ShieldOff,
  ShieldCheck,
  Sparkles,
  Stamp,
  Users,
  Workflow,
  X,
} from "lucide-react";
import { useSidebar } from "@/components/sidebar-context";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/trpc/client";

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

const userNav: NavGroup[] = [
  {
    items: [
      { href: "/chats", icon: MessageSquare, label: "My Chats" },
      { href: "/flows", icon: GitBranch, label: "Flows" },
      { href: "/approvals", icon: Stamp, label: "Approvals" },
      { href: "/settings", icon: Settings, label: "Settings" },
    ],
  },
];

const adminNav: NavGroup[] = [
  {
    items: [
      { href: "/admin/dashboards/overview", icon: Activity, label: "Overview" },
      { href: "/admin/dashboards/insights", icon: PieChart, label: "Flow Insights" },
      { href: "/admin/dashboards/flows", icon: BarChart2, label: "Flow Usage" },
      { href: "/admin/sessions", icon: MessageSquare, label: "All Chats" },
      { href: "/admin/flows", icon: GitBranch, label: "Flows" },
      { href: "/admin/settings", icon: Settings, label: "Configuration" },
    ],
  },
  {
    label: "Flow Settings",
    items: [
      { href: "/admin/skills", icon: Sparkles, label: "Skills" },
      { href: "/admin/mcp-servers", icon: Plug, label: "MCP Servers" },
      { href: "/admin/n8n", icon: Workflow, label: "n8n" },
    ],
  },
  {
    label: "User Admin",
    items: [
      { href: "/admin/users", icon: Users, label: "Users" },
      { href: "/admin/roles", icon: ShieldCheck, label: "Roles" },
    ],
  },
  {
    label: "Advanced",
    collapsible: true,
    defaultCollapsed: true,
    items: [
      { href: "/admin/usage", icon: BarChart2, label: "Usage" },
      { href: "/admin/flags", icon: Flag, label: "Flags" },
      { href: "/admin/errors", icon: AlertCircle, label: "Errors" },
      { href: "/admin/schedules", icon: Clock, label: "Schedules" },
    ],
  },
];

interface AppSidebarProps {
  isAdmin?: boolean;
}

function NavGroups({
  groups,
  isActive,
  onNavigate,
}: {
  groups: NavGroup[];
  isActive: (href: string) => boolean;
  onNavigate: () => void;
}) {
  // A collapsible group auto-expands when it holds the active route so the
  // current page is never hidden behind a collapsed header.
  const groupHoldsActive = (group: NavGroup): boolean => group.items.some((item) => isActive(item.href));

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of groups) {
      if (group.collapsible && group.label) {
        initial[group.label] = group.defaultCollapsed ?? false;
      }
    }
    return initial;
  });

  return (
    <>
      {groups.map((group, index) => {
        const isCollapsible = Boolean(group.collapsible && group.label);
        const isCollapsed = isCollapsible && (collapsed[group.label as string] ?? false) && !groupHoldsActive(group);

        return (
          <div key={group.label ?? `group-${index}`} className={index > 0 ? "mt-[6px]" : undefined}>
            {group.label &&
              (isCollapsible ? (
                <button
                  type="button"
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [group.label as string]: !prev[group.label as string] }))
                  }
                  className="flex w-full items-center justify-between px-[10px] pb-[6px] pt-[8px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#6d6a65] transition-colors hover:text-[#5a5650]"
                >
                  {group.label}
                  <ChevronDown
                    className={`h-[13px] w-[13px] shrink-0 transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                  />
                </button>
              ) : (
                <div className="px-[10px] pb-[6px] pt-[8px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#6d6a65]">
                  {group.label}
                </div>
              ))}

            {!isCollapsed &&
              group.items.map(({ href, icon: Icon, label }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
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
          </div>
        );
      })}
    </>
  );
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

  const handleSignOut = async (): Promise<void> => {
    await authClient.signOut();
    window.location.href = "/login";
  };

  // Curators reach the knowledge base from their primary nav, admin or not; the
  // page and its tRPC procedures enforce knowledge:curate regardless (ADR-021).
  const canCurate =
    (userQuery.data?.isAdmin ?? false) ||
    (userQuery.data?.permissions ?? []).includes("knowledge:curate");

  // Skills / MCP Servers are power-user features (ADR-022). Hide their nav entries
  // when the caller lacks the flag — `isEnabledForMe` already accounts for role
  // scoping, so this covers both "flag off" and "not entitled by role".
  const mcpEnabled =
    trpc.featureFlag.isEnabledForMe.useQuery({ key: "mcp" }, { enabled: isAdmin }).data ?? false;
  const skillsEnabled =
    trpc.featureFlag.isEnabledForMe.useQuery({ key: "skills" }, { enabled: isAdmin }).data ?? false;
  // n8n only powers automated (auto) nodes, so its page follows the auto_node flag.
  const autoNodeEnabled =
    trpc.featureFlag.isEnabledForMe.useQuery({ key: "auto_node" }, { enabled: isAdmin }).data ?? false;

  // Drop Skills / MCP Servers / n8n from "Flow Settings" unless the flag entitles the user.
  const gatedAdminNav = adminNav.map((group) => {
    if (group.label !== "Flow Settings") return group;
    const items = group.items.filter((item) => {
      if (item.href === "/admin/skills") return skillsEnabled;
      if (item.href === "/admin/mcp-servers") return mcpEnabled;
      if (item.href === "/admin/n8n") return autoNodeEnabled;
      return true;
    });
    return { ...group, items };
  });

  const baseNav = isAdmin ? gatedAdminNav : userNav;
  const knowledgeItem: NavItem = { href: "/knowledge", icon: BookOpen, label: "Knowledge" };
  // Curators reach Knowledge from their primary nav. For admins it belongs with the
  // other flow-authoring surfaces under "Flow Settings"; for users it sits in the
  // single top group.
  const nav: NavGroup[] = (!canCurate
    ? baseNav
    : isAdmin
      ? baseNav.map((group) =>
          group.label === "Flow Settings"
            ? { ...group, items: [...group.items, knowledgeItem] }
            : group,
        )
      : [
          { ...baseNav[0]!, items: [...baseNav[0]!.items, knowledgeItem] },
          ...baseNav.slice(1),
        ]
  ).filter((group) => group.items.length > 0);
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

  const recentChatsBlock = recentChats.length > 0 && (
    <>
      <hr className="my-[10px] border-[#dedad2]" />
      <div className="px-[10px] pb-[6px] pt-[4px] text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[#6d6a65]">
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
                ? "bg-[#eaf6f0] text-[#247c53]"
                : "bg-[#eef1fc] text-[#3a5fd9]"
            }`}
          >
            {chat.status === "complete" ? "Done" : "In Progress"}
          </span>
        </Link>
      ))}
    </>
  );

  const footer = (
    <div className="border-t border-[#dedad2] px-[10px] py-[12px]">
      {isAdmin && (
        <button
          onClick={() => {
            closeMobile();
            router.push("/chats");
          }}
          className="mb-[10px] flex w-full items-center gap-[7px] rounded-[8px] border border-[#e8b87c] bg-[#fdf3e3] px-[10px] py-[8px] text-[12px] font-medium text-[#9b6215] transition-colors hover:border-[#d4a265] hover:bg-[#fae8ce]"
        >
          <ShieldOff className="h-[13px] w-[13px] shrink-0" />
          <span>Exit admin mode</span>
        </button>
      )}
      {!isAdmin && user?.isAdmin && (
        <button
          onClick={() => {
            closeMobile();
            router.push("/admin/sessions");
          }}
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
            {user.email && <div className="truncate text-[11px] text-[#6d6a65]">{user.email}</div>}
          </div>
        </div>
      )}
      {user && (
        <button
          onClick={() => {
            closeMobile();
            void handleSignOut();
          }}
          className="mt-[6px] flex w-full items-center gap-[9px] rounded-[8px] px-[10px] py-[8px] text-[13px] text-[#5a5650] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
        >
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
            <LogOut className="h-[15px] w-[15px]" />
          </span>
          Sign out
        </button>
      )}
    </div>
  );

  const navBody = (
    <nav className="flex flex-1 flex-col gap-[2px] overflow-y-auto px-[10px] py-[12px]">
      <NavGroups groups={nav} isActive={isActive} onNavigate={closeMobile} />
      {recentChatsBlock}
    </nav>
  );

  return (
    <>
      {/* Desktop: 220px text sidebar */}
      <aside className="hidden h-screen w-[220px] shrink-0 flex-col border-r border-[#dedad2] bg-white md:flex">
        {/* Logo */}
        <div className="flex items-center gap-[9px] border-b border-[#dedad2] px-[18px] pb-[14px] pt-[16px]">
          <Link href={homeHref}>
            <div className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[7px] bg-[#3a5fd9] text-[11px] font-bold text-white">
              W
            </div>
          </Link>
          <span className="text-[14px] font-bold tracking-[-0.3px] text-[#1a1814]">Wayfinder</span>
          <span className="rounded-[5px] bg-[#eef1fc] px-[5px] py-[1px] text-[9px] font-semibold uppercase tracking-[0.06em] text-[#3a5fd9]">
            Alpha
          </span>
        </div>
        {navBody}
        {footer}
      </aside>

      {/* Mobile: hamburger triggers the drawer managed by parent context */}
      {mobileOpen && (
        <>
          {/* Backdrop — a button so it is keyboard-focusable and dismissable */}
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-[rgba(20,18,15,0.35)]"
            onClick={closeMobile}
          />
          {/* Drawer */}
          <div className="fixed bottom-0 left-0 top-0 z-50 flex w-[220px] flex-col bg-white shadow-[4px_0_20px_rgba(0,0,0,.12)]">
            <div className="flex items-center justify-between border-b border-[#dedad2] px-[14px] py-[14px] pb-[12px]">
              <div className="flex items-center gap-[9px]">
                <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[#3a5fd9] text-[11px] font-bold text-white">
                  W
                </div>
                <span className="text-[14px] font-bold tracking-[-0.2px] text-[#1a1814]">Wayfinder</span>
                <span className="rounded-[5px] bg-[#eef1fc] px-[5px] py-[1px] text-[9px] font-semibold uppercase tracking-[0.06em] text-[#3a5fd9]">
                  Alpha
                </span>
              </div>
              <button
                onClick={closeMobile}
                className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#dedad2] text-[#6d6a65] hover:bg-[#efede8]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {navBody}
            {footer}
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
