import Link from "next/link";
import type { Flow, Session } from "@rbrasier/domain";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

interface SessionCardProps {
  session: Session;
  flow: Flow | undefined;
  userBadge?: { name: string; initials: string } | null;
}

const statusVariant = (status: string) => {
  if (status === "active") return "default";
  if (status === "complete") return "secondary";
  return "outline";
};

const formatRelativeTime = (date: Date): string => {
  const diff = (Date.now() - new Date(date).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(date).toLocaleDateString();
};

export function SessionCard({ session, flow, userBadge }: SessionCardProps) {
  const title = session.title ?? flow?.name ?? "Untitled session";

  return (
    <Link href={`/chats/${session.id}`}>
      <Card className="cursor-pointer p-4 transition-shadow hover:shadow-md">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xl">
            {flow?.icon ?? "💬"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-medium text-sm">{title}</p>
              <Badge variant={statusVariant(session.status)} className="shrink-0 text-xs capitalize">
                {session.status}
              </Badge>
            </div>
            {flow && (
              <p className="text-xs text-muted-foreground">{flow.name}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {formatRelativeTime(session.updatedAt)}
            </p>
            {userBadge && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[10px] font-medium text-indigo-700">
                  {userBadge.initials}
                </span>
                <span className="text-xs text-muted-foreground">{userBadge.name}</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}
