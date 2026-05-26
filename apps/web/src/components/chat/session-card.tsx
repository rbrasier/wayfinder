import Link from "next/link";
import type { Flow, Session } from "@rbrasier/domain";

export interface SessionCardStepInfo {
  currentIndex: number;
  totalSteps: number;
  completedSteps: number;
  currentConfidence: number;
}

interface SessionCardProps {
  session: Session;
  flow: Flow | undefined;
  userBadge?: { name: string; initials: string } | null;
  stepInfo?: SessionCardStepInfo | null;
}

const STATUS_LABEL: Record<string, string> = {
  active: "In progress",
  complete: "Complete",
  abandoned: "Closed",
};

const STATUS_PILL: Record<string, string> = {
  active: "bg-[#eef1fc] text-[#3a5fd9]",
  complete: "bg-[#eaf6f0] text-[#2e9e6a]",
  abandoned: "bg-[#efede8] text-[#918d87]",
};

const formatRelativeTime = (date: Date): string => {
  const now = new Date();
  const d = new Date(date);
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) {
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return `${Math.floor(diff / 3600)}h ago`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};

const computeProgress = (
  session: Session,
  stepInfo: SessionCardStepInfo | null | undefined,
): number | null => {
  if (session.status === "complete") return 100;
  if (!stepInfo || stepInfo.totalSteps === 0) return null;
  const completedPortion = (stepInfo.completedSteps / stepInfo.totalSteps) * 100;
  const raw = completedPortion + stepInfo.currentConfidence;
  return Math.max(0, Math.min(100, Math.round(raw)));
};

export function SessionCard({ session, flow, userBadge, stepInfo }: SessionCardProps) {
  const title = session.title ?? flow?.name ?? "Untitled session";
  const pillClass = STATUS_PILL[session.status] ?? "bg-[#efede8] text-[#918d87]";
  const statusLabel = STATUS_LABEL[session.status] ?? session.status;
  const progress = computeProgress(session, stepInfo);

  return (
    <Link href={`/chats/${session.id}`} className="block w-full">
      <div className="flex cursor-pointer items-start gap-[14px] rounded-[14px] border-[1.5px] border-[#dedad2] bg-white p-[16px_18px] transition-[border-color,box-shadow] hover:border-[#3a5fd9] hover:shadow-[0_2px_8px_rgba(0,0,0,.09),0_12px_36px_rgba(0,0,0,.07)]">
        <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#eef1fc] text-[18px]">
          {flow?.icon ?? "💬"}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-[3px] flex items-baseline justify-between gap-2">
            <span className="truncate text-[14px] font-semibold tracking-[-0.2px] text-[#1a1814]">
              {title}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-[#918d87]">
              {formatRelativeTime(new Date(session.updatedAt))}
            </span>
          </div>

          {flow && (
            <p className="mb-[10px] truncate text-[12.5px] leading-[1.4] text-[#918d87]">
              <span className="font-medium text-[#3a5fd9]">{flow.name}</span>
            </p>
          )}

          <div className="flex items-center gap-[6px]">
            <div className="h-[4px] flex-1 overflow-hidden rounded-full bg-[#e6e3dc]">
              {progress !== null && (
                <div
                  className="h-full rounded-full bg-[#3a5fd9] transition-all"
                  style={{ width: `${progress}%` }}
                />
              )}
            </div>
            {stepInfo && stepInfo.totalSteps > 0 && (
              <span className="shrink-0 font-mono text-[11px] text-[#918d87]">
                Step {Math.max(1, stepInfo.currentIndex)}/{stepInfo.totalSteps} · {progress ?? 0}%
              </span>
            )}
            <span className={`shrink-0 rounded-full px-[9px] py-[3px] text-[11px] font-semibold ${pillClass}`}>
              {statusLabel}
            </span>
          </div>

          {userBadge && (
            <div className="mt-[6px] flex items-center gap-[5px]">
              <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[#dedad2] bg-[#efede8] text-[9px] font-bold text-[#918d87]">
                {userBadge.initials}
              </div>
              <span className="text-[11px] text-[#918d87]">{userBadge.name}</span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
