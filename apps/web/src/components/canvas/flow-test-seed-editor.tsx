"use client";

import type { FlowTestSeed, SeedContextItem, SeedReject } from "@wayfinder/domain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type SeedSource = "empty" | "clone" | "fixture" | "generated";

const SOURCE_LABELS: Record<SeedSource, string> = {
  empty: "Nothing — run from the start",
  clone: "Clone a real session",
  fixture: "A saved fixture",
  generated: "Generate with AI",
};

// Prior-step data, editable by hand whatever it came from. A cloned or
// generated seed is a starting point, not a verdict — the author is expected to
// correct it, which is why every value is a plain input rather than read-only
// evidence of what the source produced.
export function FlowTestSeedEditor({
  seed,
  source,
  rejects,
  fixtures,
  seedableSessions,
  selectedFixtureId,
  selectedSessionId,
  isBusy,
  onSourceChange,
  onSeedChange,
  onSelectFixture,
  onSelectSession,
  onSaveFixture,
}: {
  seed: FlowTestSeed;
  source: SeedSource;
  rejects: SeedReject[];
  fixtures: { id: string; name: string }[];
  seedableSessions: { id: string; title: string | null; updatedAt: Date }[];
  selectedFixtureId: string | null;
  selectedSessionId: string | null;
  isBusy: boolean;
  onSourceChange: (source: SeedSource) => void;
  onSeedChange: (seed: FlowTestSeed) => void;
  onSelectFixture: (fixtureId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onSaveFixture: (name: string) => void;
}) {
  const updateContextValue = (index: number, value: string) => {
    const gatheredContext = seed.gatheredContext.map((item, cursor) =>
      cursor === index ? { ...item, value } : item,
    );
    onSeedChange({ ...seed, gatheredContext });
  };

  const updateFieldValue = (stepIndex: number, fieldIndex: number, value: string) => {
    const stepOutputs = seed.stepOutputs.map((stepOutput, cursor) =>
      cursor === stepIndex
        ? {
            ...stepOutput,
            fields: stepOutput.fields.map((field, fieldCursor) =>
              fieldCursor === fieldIndex ? { ...field, value } : field,
            ),
          }
        : stepOutput,
    );
    onSeedChange({ ...seed, stepOutputs });
  };

  const removeContextItem = (index: number) => {
    onSeedChange({
      ...seed,
      gatheredContext: seed.gatheredContext.filter((_, cursor) => cursor !== index),
    });
  };

  const isEmpty = seed.gatheredContext.length === 0 && seed.stepOutputs.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Simulate the steps before this one with
        </span>
        <div className="flex flex-col gap-1">
          {(Object.keys(SOURCE_LABELS) as SeedSource[]).map((candidate) => (
            <label key={candidate} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="seed-source"
                value={candidate}
                checked={source === candidate}
                disabled={isBusy}
                onChange={() => onSourceChange(candidate)}
              />
              {SOURCE_LABELS[candidate]}
            </label>
          ))}
        </div>
      </div>

      {source === "fixture" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Saved fixtures (only yours)</span>
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            value={selectedFixtureId ?? ""}
            disabled={isBusy}
            onChange={(event) => onSelectFixture(event.target.value)}
          >
            <option value="">Choose a fixture…</option>
            {fixtures.map((fixture) => (
              <option key={fixture.id} value={fixture.id}>
                {fixture.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {source === "clone" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Real sessions on this flow</span>
          <select
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
            value={selectedSessionId ?? ""}
            disabled={isBusy}
            onChange={(event) => onSelectSession(event.target.value)}
          >
            <option value="">Choose a session…</option>
            {seedableSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title ?? "Untitled session"}
              </option>
            ))}
          </select>
        </label>
      )}

      {rejects.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {rejects.length} value{rejects.length === 1 ? "" : "s"} could not be used
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {rejects.map((reject, index) => (
              <li key={`${reject.nodeId}-${reject.key}-${index}`}>
                <span className="font-medium">{reject.key}</span>: {reject.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isEmpty && (
        <div className="flex flex-col gap-3">
          {seed.stepOutputs.map((stepOutput, stepIndex) => (
            <div key={stepOutput.nodeId} className="rounded-md border p-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Captured values
              </span>
              <div className="mt-2 flex flex-col gap-2">
                {stepOutput.fields.map((field, fieldIndex) => (
                  <label key={field.key} className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-muted-foreground">{field.label}</span>
                    <Input
                      value={field.value}
                      disabled={isBusy}
                      onChange={(event) =>
                        updateFieldValue(stepIndex, fieldIndex, event.target.value)
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}

          {seed.gatheredContext.length > 0 && (
            <div className="rounded-md border p-3">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Gathered context
              </span>
              <div className="mt-2 flex flex-col gap-2">
                {seed.gatheredContext.map((item: SeedContextItem, index) => (
                  <div key={`${item.nodeId}-${item.key}-${index}`} className="flex items-end gap-2">
                    <label className="flex flex-1 flex-col gap-1 text-sm">
                      <span className="text-xs text-muted-foreground">{item.key}</span>
                      <Input
                        value={item.value}
                        disabled={isBusy}
                        onChange={(event) => updateContextValue(index, event.target.value)}
                      />
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={isBusy}
                      onClick={() => removeContextItem(index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!isEmpty && (
        <div className="rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            Saving keeps these values so you can re-run the same test after changing the step. A
            seed cloned from a real session may contain real personal or commercial data — it is
            stored, and only you can see it.
          </p>
          <Button
            className="mt-2"
            variant="secondary"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              const name = window.prompt("Name this fixture");
              if (name?.trim()) onSaveFixture(name.trim());
            }}
          >
            Save as fixture
          </Button>
        </div>
      )}
    </div>
  );
}
