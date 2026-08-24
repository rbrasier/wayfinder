"use client";

import { useState } from "react";
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
import { FlowSelector } from "@/components/admin/flow-selector";

// A step that loses this many sessions is worth flagging rather than leaving the
// reader to spot it in the table.
const PROBLEM_THRESHOLD = 10;

const CONTINUED = "#2f56d3";
const ABANDONED = "#a8324c";
const STALLED = "#b8651a";

const formatMinutes = (minutes: number): string => {
  if (minutes <= 0) return "—";
  if (minutes < 60) return `${minutes}m`;
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${whole}h` : `${whole}h ${rest}m`;
};

export function AdminFlowHealth() {
  const [selectedFlowId, setSelectedFlowId] = useState<string | undefined>(undefined);
  const deepDiveQuery = trpc.analytics.flowDeepDive.useQuery({ flowId: selectedFlowId });
  const data = deepDiveQuery.data;

  if (deepDiveQuery.isLoading || !data) {
    return (
      <div className="h-full overflow-auto">
        <div className="container py-8 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (data.flows.length === 0) {
    return (
      <div className="h-full overflow-auto">
        <div className="container py-8 text-sm text-muted-foreground">
          No flows yet. Create a flow and run some sessions to see its health here.
        </div>
      </div>
    );
  }

  const activeFlowId = selectedFlowId ?? data.selectedFlowId ?? undefined;
  const steps = data.stepFunnel;
  const maxEntered = Math.max(...steps.map((step) => step.entered), 1);
  const firstStep = steps[0];
  const lastStep = steps[steps.length - 1];

  const totalStalled = steps.reduce((sum, step) => sum + step.stalled, 0);
  const totalAbandoned = steps.reduce((sum, step) => sum + step.abandoned, 0);
  const worstStep = [...steps].sort(
    (a, b) => b.abandoned + b.stalled - (a.abandoned + a.stalled),
  )[0];
  const worstLost = worstStep ? worstStep.abandoned + worstStep.stalled : 0;

  return (
    <div className="h-full overflow-auto">
      <div className="container space-y-4 py-8">
        <div>
          <h1 className="text-lg font-semibold text-[#1c1b19]">Flow Health</h1>
          <p className="text-[13px] text-[#666055]">
            Where the path breaks — drop-off, abandonment and stalls, step by step.
          </p>
        </div>

        <FlowSelector flows={data.flows} activeFlowId={activeFlowId} onSelect={setSelectedFlowId} />

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              The path
              {firstStep && lastStep
                ? ` — ${firstStep.entered} started, ${lastStep.continued} through`
                : ""}
            </CardTitle>
            <p className="text-[11.5px] text-[#736d5f]">
              Steps in graph order. Each bar shows what happened to the sessions that reached it.
            </p>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex flex-wrap gap-4 text-[11.5px] text-[#5c574c]">
              <Legend colour={CONTINUED} label="Continued" />
              <Legend colour={ABANDONED} label="Abandoned — someone gave up" />
              <Legend colour={STALLED} label="Stalled — open, untouched over 7 days" />
            </div>

            {steps.length === 0 ? (
              <p className="text-[13px] text-[#666055]">No step activity recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {steps.map((step) => {
                  const lost = step.abandoned + step.stalled;
                  const width = (value: number) => `${(value / maxEntered) * 100}%`;
                  return (
                    <div key={step.nodeId}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[12px] font-medium text-[#1c1b19]">
                          {step.nodeName}
                        </span>
                        <span className="text-[10.5px] tabular-nums text-[#736d5f]">
                          {step.entered} in · {step.continued} continued ·{" "}
                          {formatMinutes(step.medianMinutes)} median
                        </span>
                      </div>
                      <div className="mt-1.5 flex h-3.5 items-stretch gap-[2px]">
                        {step.continued > 0 && (
                          <div
                            className="rounded-sm"
                            style={{ width: width(step.continued), backgroundColor: CONTINUED }}
                            title={`${step.continued} continued`}
                          />
                        )}
                        {step.abandoned > 0 && (
                          <div
                            className="rounded-sm"
                            style={{ width: width(step.abandoned), backgroundColor: ABANDONED }}
                            title={`${step.abandoned} abandoned`}
                          />
                        )}
                        {step.stalled > 0 && (
                          <div
                            className="rounded-sm"
                            style={{ width: width(step.stalled), backgroundColor: STALLED }}
                            title={`${step.stalled} stalled`}
                          />
                        )}
                        {lost > 0 && (
                          <span
                            className={`self-center pl-2 text-[10.5px] tabular-nums ${
                              lost >= PROBLEM_THRESHOLD
                                ? "font-medium text-[#b8651a]"
                                : "text-[#736d5f]"
                            }`}
                          >
                            −{lost}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">Worst step</CardTitle>
            </CardHeader>
            <CardContent>
              {worstStep && worstLost > 0 ? (
                <>
                  <p className="text-base font-semibold text-[#1c1b19]">{worstStep.nodeName}</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[#736d5f]">
                    <span className="font-medium text-[#a8324c]">
                      {worstLost} of {worstStep.entered}
                    </span>{" "}
                    leave here — {worstStep.abandoned} abandoned, {worstStep.stalled} stalled.
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-[#666055]">Nothing is being lost.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Stalled right now
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums text-[#8a5a1d]">{totalStalled}</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[#736d5f]">
                Open cases untouched for more than 7 days. Still recoverable — someone can pick
                them up.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium text-muted-foreground">Abandoned</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums text-[#a8324c]">{totalAbandoned}</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-[#736d5f]">
                Explicitly given up on. Counted apart from stalls, because the two need different
                responses.
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Step breakdown
            </CardTitle>
            <p className="text-[11.5px] text-[#736d5f]">
              Median time, not mean — one long pause no longer moves a step&apos;s figure.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Step</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Continued</TableHead>
                  <TableHead className="text-right">Abandoned</TableHead>
                  <TableHead className="text-right">Stalled</TableHead>
                  <TableHead className="text-right">Still open</TableHead>
                  <TableHead className="text-right">Median time</TableHead>
                  <TableHead className="text-right">Avg turns</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {steps.map((step) => {
                  const lost = step.abandoned + step.stalled;
                  return (
                    <TableRow
                      key={step.nodeId}
                      className={lost >= PROBLEM_THRESHOLD ? "bg-[#f6e9d8]" : undefined}
                    >
                      <TableCell className="font-medium">{step.nodeName}</TableCell>
                      <TableCell className="text-right tabular-nums">{step.entered}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {step.continued}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {step.abandoned === 0 ? (
                          <span className="text-[#736d5f]">—</span>
                        ) : (
                          <span className="font-medium text-[#a8324c]">{step.abandoned}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {step.stalled === 0 ? (
                          <span className="text-[#736d5f]">—</span>
                        ) : (
                          <span className="font-medium text-[#8a5a1d]">{step.stalled}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#736d5f]">
                        {step.inFlight === 0 ? "—" : step.inFlight}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMinutes(step.medianMinutes)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-[#736d5f]">
                        {step.averageTurns}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {steps.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-[13px] text-[#666055]">
                      No step activity recorded for this flow yet.
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

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colour }} />
      {label}
    </span>
  );
}
