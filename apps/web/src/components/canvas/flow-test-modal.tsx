"use client";

import { useCallback, useEffect, useState } from "react";
import type { FlowTestSeed, SeedReject } from "@wayfinder/domain";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChatSessionContent } from "@/app/(user)/chats/[sessionId]/_content";
import { trpc } from "@/trpc/client";
import { FlowTestSeedEditor, type SeedSource } from "./flow-test-seed-editor";
import { FlowTestStepReportPane } from "./flow-test-step-report";

const EMPTY_SEED: FlowTestSeed = { gatheredContext: [], stepOutputs: [] };

export interface FlowTestModalProps {
  open: boolean;
  flowId: string;
  // The step under test. Null runs the whole flow from its root — the same
  // mechanism with an empty seed, not a separate mode.
  startNodeId: string | null;
  startNodeName: string | null;
  onClose: () => void;
}

// Near-full-screen so a transcript and a report fit side by side, and a modal
// rather than a route so the author never leaves the canvas — closing returns
// them to exactly the viewport they left (ADR-048). The trade is that a run
// cannot be deep-linked, which is accepted for this version.
export function FlowTestModal({
  open,
  flowId,
  startNodeId,
  startNodeName,
  onClose,
}: FlowTestModalProps) {
  const [source, setSource] = useState<SeedSource>("empty");
  const [seed, setSeed] = useState<FlowTestSeed>(EMPTY_SEED);
  const [rejects, setRejects] = useState<SeedReject[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fixturesQuery = trpc.flowTest.fixture.list.useQuery({ flowId }, { enabled: open });
  const seedableQuery = trpc.flowTest.listSeedableSessions.useQuery(
    { flowId },
    { enabled: open && source === "clone" },
  );
  const reportQuery = trpc.flowTest.report.useQuery(
    { sessionId: sessionId ?? "" },
    { enabled: Boolean(sessionId), refetchInterval: sessionId ? 4000 : false },
  );

  const startMutation = trpc.flowTest.start.useMutation();
  const cloneMutation = trpc.flowTest.cloneSeed.useMutation();
  const generateMutation = trpc.flowTest.generateSeed.useMutation();
  const saveFixtureMutation = trpc.flowTest.fixture.create.useMutation();
  const deleteMutation = trpc.flowTest.delete.useMutation();

  // Reopening the modal on a different step must not inherit the previous
  // step's seed — the values belong to the steps before *that* node.
  useEffect(() => {
    if (open) return;
    setSource("empty");
    setSeed(EMPTY_SEED);
    setRejects([]);
    setSessionId(null);
    setNotice(null);
  }, [open]);

  const applySource = useCallback(
    async (next: SeedSource) => {
      setSource(next);
      setRejects([]);
      setNotice(null);
      if (next === "empty") {
        setSeed(EMPTY_SEED);
        return;
      }
      if (next !== "generated" || !startNodeId) return;

      const generated = await generateMutation.mutateAsync({ flowId, startNodeId });
      setSeed(generated.seed);
      setRejects(generated.rejects);
      if (generated.failureReason) {
        setNotice(`Could not generate a seed: ${generated.failureReason}. Fill it in by hand.`);
      }
    },
    [flowId, generateMutation, startNodeId],
  );

  const loadFixture = useCallback(
    (fixtureId: string) => {
      setSelectedFixtureId(fixtureId);
      const fixture = fixturesQuery.data?.find((candidate) => candidate.id === fixtureId);
      if (!fixture) return;
      setSeed({ gatheredContext: fixture.gatheredContext, stepOutputs: fixture.stepOutputs });
    },
    [fixturesQuery.data],
  );

  const loadClone = useCallback(
    async (sourceSessionId: string) => {
      setSelectedSessionId(sourceSessionId);
      if (!startNodeId) return;
      const cloned = await cloneMutation.mutateAsync({
        sessionId: sourceSessionId,
        upToNodeId: startNodeId,
      });
      setSeed(cloned.seed);
    },
    [cloneMutation, startNodeId],
  );

  const run = useCallback(async () => {
    const started = await startMutation.mutateAsync({
      flowId,
      startNodeId: startNodeId ?? undefined,
      seed,
    });
    setSessionId(started.session.id);
    setRejects(started.rejects);
  }, [flowId, seed, startNodeId, startMutation]);

  const discard = useCallback(async () => {
    if (!sessionId) return;
    await deleteMutation.mutateAsync({ sessionId });
    setSessionId(null);
  }, [deleteMutation, sessionId]);

  const isBusy =
    startMutation.isPending ||
    cloneMutation.isPending ||
    generateMutation.isPending ||
    saveFixtureMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[92vw] h-[88vh] flex flex-col p-0">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <DialogTitle className="text-base">
              {startNodeName ? `Test "${startNodeName}"` : "Test this flow"}
            </DialogTitle>
            <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
              Test
            </span>
            {/* Radix warns without one, and a screen-reader user opening a
                near-full-screen dialog needs to know it is a disposable run. */}
            <DialogDescription className="sr-only">
              Runs this flow against disposable data. Nothing here reaches operators, dashboards or
              approver queues.
            </DialogDescription>
          </div>
          <DialogCloseButton />
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <aside className="w-[380px] shrink-0 overflow-y-auto border-r p-4">
            <FlowTestSeedEditor
              seed={seed}
              source={source}
              rejects={rejects}
              fixtures={fixturesQuery.data ?? []}
              seedableSessions={seedableQuery.data ?? []}
              selectedFixtureId={selectedFixtureId}
              selectedSessionId={selectedSessionId}
              isBusy={isBusy}
              onSourceChange={(next) => void applySource(next)}
              onSeedChange={setSeed}
              onSelectFixture={loadFixture}
              onSelectSession={(id) => void loadClone(id)}
              onSaveFixture={(name) => {
                if (!startNodeId) return;
                void saveFixtureMutation.mutateAsync({
                  flowId,
                  name,
                  startNodeId,
                  gatheredContext: seed.gatheredContext,
                  stepOutputs: seed.stepOutputs,
                });
              }}
            />

            <div className="mt-4 flex gap-2">
              <Button onClick={() => void run()} disabled={isBusy || Boolean(sessionId)}>
                {sessionId ? "Running" : "Start test run"}
              </Button>
              {sessionId && (
                <Button variant="ghost" onClick={() => void discard()}>
                  Discard run
                </Button>
              )}
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
            <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              This is a test run. It is invisible to operators, dashboards and approver queues, and
              any approval it reaches is assigned to you rather than a real supervisor. It spends
              real tokens.
            </div>

            {notice && (
              <div className="mb-3 rounded-md border px-3 py-2 text-xs text-muted-foreground">
                {notice}
              </div>
            )}

            {sessionId ? (
              <>
                {/* The operator's own chat surface, mounted directly. The
                    modal drives the real stream rather than a copy of it —
                    a reimplementation here would test the harness, not the
                    flow the author is about to publish (ADR-048 §1). */}
                <div className="mb-4 h-[45vh] overflow-hidden rounded-md border">
                  <ChatSessionContent sessionId={sessionId} />
                </div>
                <FlowTestStepReportPane
                  steps={reportQuery.data?.steps ?? []}
                  totalCostUsd={reportQuery.data?.totalCostUsd ?? 0}
                  isRunning
                />
              </>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                Choose what the earlier steps should have gathered, then start the run. The step is
                exercised by the same runner operators use — nothing about it is simulated except
                the data you seed.
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
