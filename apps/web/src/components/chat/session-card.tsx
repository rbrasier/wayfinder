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
  lastMessage?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  active: "In progress",
  complete: "Complete",
  abandoned: "Closed",
};

const STATUS_BADGE: Record<string, string> = {
  active: "bg-[#eef1fc] text-[#3a5fd9] border border-[#c5d0f7]",
  complete: "bg-[#eaf6f0] text-[#247c53] border border-[#c0e8d5]",
  abandoned: "bg-[#efede8] text-[#6d6a65] border border-[#dedad2]",
};

const formatRelativeTime = (date: Date): string => {
  const now = new Date();
  const d = new Date(date);
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const todayStr = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (d.toDateString() === todayStr) return `Today, ${timeStr}`;
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday, ${timeStr}`;

  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 86400 * 7) {
    return d.toLocaleDateString([], { weekday: "short" }) + `, ${timeStr}`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + `, ${timeStr}`;
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

export function SessionCard({ session, flow, userBadge, stepInfo, lastMessage }: SessionCardProps) {
  const title = session.title ?? flow?.name ?? "Untitled session";
  const badgeClass = STATUS_BADGE[session.status] ?? "bg-[#efede8] text-[#6d6a65] border border-[#dedad2]";
  const statusLabel = STATUS_LABEL[session.status] ?? session.status;
  const progress = computeProgress(session, stepInfo);

  return (
    <Link href={`/chats/${session.id}`} className="block w-full">
      <div className="flex cursor-pointer items-center gap-[14px] rounded-[14px] border-[1.5px] border-[#dedad2] bg-white p-[16px_18px] transition-[border-color,box-shadow] hover:border-[#3a5fd9] hover:shadow-[0_2px_8px_rgba(0,0,0,.09),0_12px_36px_rgba(0,0,0,.07)]">

        {/* Icon */}
        <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] bg-[#eef1fc] text-[18px]">
          {flow?.icon ?? "💬"}
        </div>

        {/* Centre: title + flow · preview */}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold tracking-[-0.2px] text-[#1a1814]">
            {title}
          </p>
          <p className="mt-[3px] truncate text-[12.5px] leading-[1.4] text-[#6d6a65]">
            {flow && (
              <span className="font-medium text-[#3a5fd9]">{flow.name}</span>
            )}
            {flow && lastMessage && <span className="text-[#726f6b]"> · </span>}
            {lastMessage && <span>{lastMessage}</span>}
          </p>
          {userBadge && (
            <div className="mt-[6px] flex items-center gap-[5px]">
              <div className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-[#dedad2] bg-[#efede8] text-[9px] font-bold text-[#6d6a65]">
                {userBadge.initials}
              </div>
              <span className="text-[11px] text-[#6d6a65]">{userBadge.name}</span>
            </div>
          )}
        </div>

        {/* Right: progress column + timestamp column */}
        <div className="flex shrink-0 items-center gap-4">

          {/* Progress column: badge → bar → step info */}
          <div className="flex w-[150px] flex-col gap-[6px]">
            <div className="flex justify-center">
              <span className={`rounded-full px-[8px] py-[2px] text-[11px] font-semibold ${badgeClass}`}>
                {statusLabel}
              </span>
            </div>

            <div className="h-[4px] overflow-hidden rounded-full bg-[#e6e3dc]">
              {progress !== null && (
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progress}%`,
                    backgroundColor: progress === 100 ? "#2e9e6a" : progress >= 60 ? "#3a5fd9" : "#d97706",
                  }}
                />
              )}
            </div>

            {stepInfo && stepInfo.totalSteps > 0 && (
              <div className="flex justify-between font-mono text-[11px] text-[#6d6a65]">
                <span>Step {Math.max(1, stepInfo.currentIndex)}/{stepInfo.totalSteps}</span>
                <span>{progress ?? 0}%</span>
              </div>
            )}
          </div>

          {/* Timestamp column */}
          <span className="w-[90px] shrink-0 text-center font-mono text-[11px] leading-[1.3] text-[#726f6b]">
            {formatRelativeTime(new Date(session.updatedAt))}
          </span>

        </div>

      </div>
    </Link>
  );
}
