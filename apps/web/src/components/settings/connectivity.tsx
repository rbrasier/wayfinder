"use client";

import { useCallback, useState } from "react";
import type { ConnectivityResult, ConnectivityTarget } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";

// Targets exercised by the header "Test all" button, in card order.
export const ALL_CONNECTIVITY_TARGETS: ConnectivityTarget[] = [
  "ai",
  "n8n",
  "embeddings",
  "storage",
  "email",
  "entra",
];

export type BadgeState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; latencyMs?: number; message?: string }
  | { status: "skipped"; message?: string }
  | { status: "failed"; message?: string };

export interface ConnectivityController {
  states: Partial<Record<ConnectivityTarget, BadgeState>>;
  runTest: (target: ConnectivityTarget) => Promise<void>;
  runAll: (targets: ConnectivityTarget[]) => Promise<void>;
  isBusy: boolean;
}

const toBadge = (result: ConnectivityResult): BadgeState => {
  if (result.skipped) return { status: "skipped", message: result.message };
  if (result.ok) return { status: "ok", latencyMs: result.latencyMs, message: result.message };
  return { status: "failed", message: result.message };
};

export function useConnectivity(): ConnectivityController {
  const [states, setStates] = useState<Partial<Record<ConnectivityTarget, BadgeState>>>({});
  const mutation = trpc.settings.testConnectivity.useMutation();

  const runTest = useCallback(
    async (target: ConnectivityTarget) => {
      setStates((prev) => ({ ...prev, [target]: { status: "testing" } }));
      try {
        const result = await mutation.mutateAsync({ target });
        setStates((prev) => ({ ...prev, [target]: toBadge(result) }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Probe failed";
        setStates((prev) => ({ ...prev, [target]: { status: "failed", message } }));
      }
    },
    [mutation],
  );

  // Fan out to per-card probes in parallel so each badge resolves independently.
  const runAll = useCallback(
    async (targets: ConnectivityTarget[]) => {
      await Promise.all(targets.map((target) => runTest(target)));
    },
    [runTest],
  );

  const isBusy = Object.values(states).some((state) => state?.status === "testing");

  return { states, runTest, runAll, isBusy };
}

export function ConnectivityBadge({ target, state }: { target: ConnectivityTarget; state?: BadgeState }) {
  if (!state || state.status === "idle") return null;

  const testId = `connectivity-badge-${target}`;
  if (state.status === "testing") {
    return (
      <span
        data-testid={testId}
        data-status="testing"
        className="inline-flex items-center gap-1 rounded-md border border-[#dedad2] bg-[#f7f6f3] px-2 py-1 text-xs text-muted-foreground"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-muted-foreground" /> Testing…
      </span>
    );
  }
  if (state.status === "ok") {
    return (
      <span
        data-testid={testId}
        data-status="ok"
        className="inline-flex rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs text-emerald-900"
      >
        Reachable{typeof state.latencyMs === "number" ? ` · ${state.latencyMs} ms` : ""}
      </span>
    );
  }
  if (state.status === "skipped") {
    return (
      <span
        data-testid={testId}
        data-status="skipped"
        className="inline-flex rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900"
      >
        {state.message ?? "Not configured"}
      </span>
    );
  }
  return (
    <span
      data-testid={testId}
      data-status="failed"
      className="inline-flex rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-900"
    >
      Failed{state.message ? `: ${state.message}` : ""}
    </span>
  );
}

export function ConnectivityTest({
  target,
  controller,
}: {
  target: ConnectivityTarget;
  controller: ConnectivityController;
}) {
  const state = controller.states[target];
  return (
    <div className="flex items-center gap-2 border-t border-[#ece9e3] pt-3">
      <Button
        size="sm"
        variant="secondary"
        data-testid={`test-connectivity-${target}`}
        onClick={() => void controller.runTest(target)}
        disabled={state?.status === "testing"}
      >
        {state?.status === "testing" ? "Testing…" : "Test connectivity"}
      </Button>
      <ConnectivityBadge target={target} state={state} />
    </div>
  );
}
