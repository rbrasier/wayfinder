"use client";

import { trpc } from "@/trpc/client";
import {
  RING,
  type UsageStatus,
  mostConstrainedPeriod,
  ringArcColour,
  ringGeometry,
} from "./usage-ring-model";

const money = (value: number): string => `$${value.toFixed(2)}`;
const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;

const resetLabel = (resetsAt: Date): string =>
  new Date(resetsAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });

interface UsagePeriod {
  period: string;
  ratio: number;
  status: UsageStatus;
  spendUsd: number;
  limitUsd: number;
  resetsAt: Date;
}

function PeriodBreakdown({ periods }: { periods: UsagePeriod[] }) {
  return (
    <>
      {periods.map((period) => (
        <div key={period.period} className="mb-[6px] last:mb-0">
          <div className="font-medium capitalize">{period.period}</div>
          <div>
            {money(period.spendUsd)} used of {money(period.limitUsd)} · {percent(period.ratio)}
          </div>
          <div className="text-[#666055]">
            {money(Math.max(period.limitUsd - period.spendUsd, 0))} remaining · resets{" "}
            {resetLabel(period.resetsAt)}
          </div>
        </div>
      ))}
    </>
  );
}

// Shared by both renderings (ADR-031): a deployment with the master switch off,
// or a user for whom no limit resolves, sees nothing at all.
const useResolvedUsage = (): { primary: UsagePeriod; periods: UsagePeriod[] } | null => {
  const usageQuery = trpc.usage.myUsage.useQuery();
  const usage = usageQuery.data;
  if (!usage || !usage.enabled || usage.periods.length === 0) return null;

  const periods = [...usage.periods].sort((first, second) => second.ratio - first.ratio);
  const primary = mostConstrainedPeriod(periods);
  if (!primary) return null;
  return { primary, periods };
};

// Compact ring for the sidebar footer, sitting to the right of the user's name.
// The figures themselves also live in the chip popover, so the ring is never the
// only way to read them.
export function UsageRing() {
  const resolved = useResolvedUsage();
  if (!resolved) return null;

  const { primary, periods } = resolved;
  const { dashArray, dashOffset } = ringGeometry(primary.ratio);
  const centre = RING.size / 2;

  return (
    <div className="group/ring relative flex shrink-0 items-center">
      <svg
        role="progressbar"
        aria-label="Usage this period"
        aria-valuenow={Math.round(primary.ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        width={RING.size}
        height={RING.size}
        viewBox={`0 0 ${RING.size} ${RING.size}`}
        // Start the sweep at 12 o'clock rather than 3.
        className="-rotate-90"
      >
        <circle
          cx={centre}
          cy={centre}
          r={RING.radius}
          fill="none"
          stroke="var(--bg3)"
          strokeWidth={RING.strokeWidth}
        />
        <circle
          cx={centre}
          cy={centre}
          r={RING.radius}
          fill="none"
          stroke={ringArcColour(primary.status)}
          strokeWidth={RING.strokeWidth}
          strokeLinecap="round"
          strokeDasharray={dashArray}
          strokeDashoffset={dashOffset}
        />
      </svg>

      <div className="pointer-events-none absolute bottom-full right-0 z-20 mb-[6px] hidden w-[190px] rounded-[9px] border border-[#e7e3db] bg-white p-[10px] text-[11px] text-[#3d382f] shadow-wf-md group-hover/ring:block">
        <PeriodBreakdown periods={periods} />
      </div>
    </div>
  );
}

// Full-width bar, for surfaces with room for it — currently the user chip
// popover. Retained alongside the ring so the breakdown stays reachable without
// hovering an 18px target.
export function UsageMeter() {
  const resolved = useResolvedUsage();
  if (!resolved) return null;

  const { primary, periods } = resolved;
  const width = `${Math.min(Math.max(primary.ratio, 0), 1) * 100}%`;

  return (
    <div className="px-[10px] py-[8px]">
      <div className="mb-[4px] flex items-center justify-between text-[10.5px] text-[#666055]">
        <span>Usage</span>
        <span>{percent(primary.ratio)}</span>
      </div>
      <div
        role="progressbar"
        aria-label="Usage this period"
        aria-valuenow={Math.round(primary.ratio * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-[5px] w-full overflow-hidden rounded-full bg-[#ebe8e0]"
      >
        <div
          className="h-full rounded-full"
          style={{ width, backgroundColor: ringArcColour(primary.status) }}
        />
      </div>
      <div className="mt-[8px] text-[10.5px] leading-normal text-[#666055]">
        <PeriodBreakdown periods={periods} />
      </div>
    </div>
  );
}
