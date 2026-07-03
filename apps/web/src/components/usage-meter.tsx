"use client";

import { trpc } from "@/trpc/client";

type Status = "ok" | "warn" | "blocked";

const FILL_COLOR: Record<Status, string> = {
  ok: "#247c53",
  warn: "#c98a2b",
  blocked: "#c0492f",
};

const money = (value: number): string => `$${value.toFixed(2)}`;
const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;

const resetLabel = (resetsAt: Date): string =>
  new Date(resetsAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// Subtle sidebar usage bar (ADR-031). Fed by usage.myUsage — hidden entirely
// when the master switch is off or no limit resolves, so a user with no cap sees
// nothing. When several periods have limits, the bar shows the most-constrained
// (highest ratio) and the hover tooltip lists every active period.
export function UsageMeter() {
  const usageQuery = trpc.usage.myUsage.useQuery();
  const usage = usageQuery.data;

  if (!usage || !usage.enabled || usage.periods.length === 0) return null;

  const periods = [...usage.periods].sort((a, b) => b.ratio - a.ratio);
  const primary = periods[0]!;
  const fill = FILL_COLOR[primary.status];
  const width = `${Math.min(Math.max(primary.ratio, 0), 1) * 100}%`;

  return (
    <div className="group relative mb-[8px] px-[10px]">
      <div className="mb-[4px] flex items-center justify-between text-[10.5px] text-[#6d6a65]">
        <span>Usage</span>
        <span>{percent(primary.ratio)}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Usage this period"
        aria-valuenow={Math.round(primary.ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-[5px] w-full overflow-hidden rounded-full bg-[#e6e3dd]"
      >
        <div className="h-full rounded-full" style={{ width, backgroundColor: fill }} />
      </div>

      <div className="pointer-events-none absolute bottom-full left-[10px] right-[10px] z-10 mb-[6px] hidden rounded-[8px] border border-[#dedad2] bg-white p-[10px] text-[11px] text-[#3d3a35] shadow-lg group-hover:block">
        {periods.map((period) => (
          <div key={period.period} className="mb-[6px] last:mb-0">
            <div className="font-medium capitalize">{period.period}</div>
            <div>
              {money(period.spendUsd)} used of {money(period.limitUsd)} · {percent(period.ratio)}
            </div>
            <div className="text-[#6d6a65]">
              {money(Math.max(period.limitUsd - period.spendUsd, 0))} remaining · resets{" "}
              {resetLabel(period.resetsAt)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
