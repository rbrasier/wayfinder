"use client";

import type { FlowTestStepReport as StepReport } from "@wayfinder/domain";

const formatCost = (costUsd: number): string =>
  costUsd === 0 ? "$0.00" : `$${costUsd.toFixed(costUsd < 0.01 ? 4 : 2)}`;

const formatLatency = (latencyMs: number): string =>
  latencyMs < 1000 ? `${latencyMs}ms` : `${(latencyMs / 1000).toFixed(1)}s`;

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col">
    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
    <span className="text-sm font-medium tabular-nums">{value}</span>
  </div>
);

// The per-step numbers an author tunes against. Deliberately plain: this is a
// diagnostic panel, not a dashboard, and the run it describes is disposable.
export function FlowTestStepReportPane({
  steps,
  totalCostUsd,
  isRunning,
}: {
  steps: StepReport[];
  totalCostUsd: number;
  isRunning: boolean;
}) {
  if (steps.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        {isRunning
          ? "Waiting for the first turn…"
          : "No turns yet. Send a message to start the run."}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Step report</h3>
        <span className="text-xs text-muted-foreground">
          {formatCost(totalCostUsd)} this run — real spend, counted against budgets
        </span>
      </div>

      {steps.map((step) => (
        <div key={step.nodeId} className="rounded-md border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{step.nodeName}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] ${
                step.advanced
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              }`}
            >
              {step.advanced ? "Advanced" : "Current"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Turns" value={String(step.turns)} />
            <Metric label="Cost" value={formatCost(step.costUsd)} />
            <Metric label="Latency" value={formatLatency(step.latencyMs)} />
            <Metric
              label="Tokens"
              value={`${step.promptTokens + step.completionTokens}`}
            />
          </div>

          {step.confidenceTrajectory.length > 0 && (
            <div className="mt-2">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Confidence
              </span>
              <div className="mt-1 flex items-center gap-1">
                {step.confidenceTrajectory.map((confidence, index) => (
                  <span
                    key={`${step.nodeId}-confidence-${index}`}
                    className="rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums"
                  >
                    {Math.round(confidence * 100)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {step.documentFilename && (
            <p className="mt-2 text-xs text-muted-foreground">
              Generated <span className="font-medium">{step.documentFilename}</span> — download it
              from the transcript to check the template filled correctly.
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
