"use client";

import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";

const AXIS_STYLE = { fontSize: 11, fill: "#736d5f" };

const money = (value: number): string => `$${value.toFixed(2)}`;

const hours = (value: number): string => `${value.toLocaleString()} h`;

const minutesAsHours = (minutes: number): string => hours(Math.round(minutes / 60));

const shortDuration = (minutes: number): string => {
  if (minutes <= 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${whole}h` : `${whole}h ${rest}m`;
};

const completionColour = (rate: number): string => {
  if (rate >= 75) return "#0f7a5a";
  if (rate >= 60) return "#b8651a";
  return "#a8324c";
};

export function AdminValueDashboard() {
  const [flowId, setFlowId] = useState<string | undefined>(undefined);
  const valueQuery = trpc.analytics.value.useQuery({ flowId });
  const data = valueQuery.data;

  if (valueQuery.isLoading || !data) {
    return (
      <div className="h-full overflow-auto">
        <div className="container py-8 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const selectedFlow = data.byFlow.find((row) => row.flowId === data.flowId);
  const hasAnyEstimate = data.estimatedSessions > 0;

  return (
    <div className="h-full overflow-auto">
      <div className="container space-y-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-[#1c1b19]">Value</h1>
            <p className="text-[13px] text-[#666055]">
              {selectedFlow ? `${selectedFlow.flowName} · ` : ""}
              Last {data.periodDays} days · {data.contributingSessions} finished{" "}
              {data.contributingSessions === 1 ? "case" : "cases"}
            </p>
          </div>
          <select
            aria-label="Filter by flow"
            className="rounded-lg border border-[#e7e3db] bg-white px-3 py-2 text-[13px] text-[#1c1b19]"
            value={flowId ?? ""}
            onChange={(event) => setFlowId(event.target.value || undefined)}
          >
            <option value="">All flows</option>
            {data.byFlow.map((row) => (
              <option key={row.flowId} value={row.flowId}>
                {row.flowName}
              </option>
            ))}
          </select>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="min-w-[280px] flex-1">
                <p className="text-sm font-medium text-muted-foreground">
                  Effort avoided
                  <span className="ml-2 rounded border border-[#e6d0ab] bg-[#f6e9d8] px-1.5 py-0.5 align-middle text-[10px] uppercase tracking-wide text-[#8a5a1d]">
                    estimate
                  </span>
                </p>
                {hasAnyEstimate ? (
                  <>
                    <p className="mt-1 text-4xl font-bold tabular-nums">≈ {hours(data.avoidedHours)}</p>
                    <p className="mt-2 max-w-[52ch] text-[12px] leading-relaxed text-[#736d5f]">
                      Time not spent doing this work by hand. Cases that were abandoned are
                      included — reaching the point one was dropped still avoided the manual work
                      up to there.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-2xl font-semibold text-[#666055]">Not enough data yet</p>
                    <p className="mt-2 max-w-[52ch] text-[12px] leading-relaxed text-[#736d5f]">
                      When someone finishes a case they are asked how long it would have taken the
                      old way. Once a few have answered, this becomes an estimate of the time saved.
                    </p>
                  </>
                )}
              </div>

              {/* Cost sits beside the hours as context. It is deliberately never
                  converted into them, nor netted against them. */}
              <div className="min-w-[190px] border-l border-[#e7e3db] pl-6">
                <p className="text-sm font-medium text-muted-foreground">AI cost to run it</p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{money(data.spendUsd)}</p>
                <p className="mt-2 max-w-[24ch] text-[12px] leading-relaxed text-[#736d5f]">
                  Shown for context, not converted to a rate or set against the hours.
                </p>
              </div>
            </div>

            {hasAnyEstimate && (
              <p className="mt-4 rounded-lg border border-[#e7e3db] bg-[#f5f3ee] px-3 py-2.5 text-[12px] leading-relaxed text-[#5c574c]">
                <span className="font-semibold text-[#1c1b19]">Where this comes from.</span> Each
                flow&apos;s baseline is the median of the estimates its operators gave, so one
                outlier cannot skew it.{" "}
                <span className="font-semibold text-[#1c1b19]">
                  Based on {data.estimatedSessions} of {data.contributingSessions} finished cases (
                  {data.coveragePct}%)
                </span>
                ; cases with no estimate are left out rather than guessed, so the real figure is
                higher than this one. Hands-on time in Wayfinder was {hours(data.handsOnHours)}.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Effort avoided per week
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[240px] w-full">
                  {data.trend.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.trend} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                        <defs>
                          <linearGradient id="avoidedFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#0f7a5a" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#0f7a5a" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f5f3ee" />
                        <XAxis
                          dataKey="weekStart"
                          tick={AXIS_STYLE}
                          tickFormatter={(value: string) => value.slice(5)}
                        />
                        <YAxis tick={AXIS_STYLE} allowDecimals={false} />
                        <Tooltip formatter={(value: number) => [hours(value), "Avoided"]} />
                        <Area
                          type="monotone"
                          dataKey="avoidedHours"
                          stroke="#0f7a5a"
                          strokeWidth={2}
                          fill="url(#avoidedFill)"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyChart />
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Time back on the calendar
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.medianCycleHours === null ? (
                <p className="text-sm text-muted-foreground">No completed cases yet.</p>
              ) : (
                <>
                  <p className="text-2xl font-bold tabular-nums">
                    {data.medianCycleHours < 24
                      ? `${data.medianCycleHours} h`
                      : `${(data.medianCycleHours / 24).toFixed(1)} d`}
                  </p>
                  <p className="mt-2 text-[12px] leading-relaxed text-[#736d5f]">
                    Median completed case, start to finish. A different benefit from hours of
                    labour, so it is reported on its own.
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Every flow, ranked by time saved
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Flow</TableHead>
                  <TableHead className="text-right">Cases</TableHead>
                  <TableHead className="w-[150px]">Completed</TableHead>
                  <TableHead className="text-right">Typical hands-on</TableHead>
                  <TableHead className="text-right">Effort avoided</TableHead>
                  <TableHead className="text-right">AI cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.byFlow.map((row) => {
                  const completionRate =
                    row.sessions === 0 ? 0 : Math.round((row.completed / row.sessions) * 100);
                  return (
                    <TableRow key={row.flowId}>
                      <TableCell className="font-medium">{row.flowName}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.sessions}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#f5f3ee]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${completionRate}%`,
                                backgroundColor: completionColour(completionRate),
                              }}
                            />
                          </div>
                          <span className="w-9 text-right text-[12px] tabular-nums text-[#5c574c]">
                            {completionRate}%
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {shortDuration(row.medianHandsOnMinutes)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {row.avoidedMinutes === null ? (
                          <span className="text-[12px] font-normal text-[#2f56d3]">
                            collecting estimates
                          </span>
                        ) : (
                          `≈ ${minutesAsHours(row.avoidedMinutes)}`
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#736d5f]">
                        {money(row.spendUsd)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {data.byFlow.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-[13px] text-[#666055]">
                      No finished cases in this period yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-[#666055]">
      Not enough data yet.
    </div>
  );
}
