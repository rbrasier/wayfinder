"use client";

import { Minimize2, X } from "lucide-react";
import type { FlowLesson } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { evidenceLabel } from "./flow-memory-panel-model";

export interface DrawerEvidenceSession {
  sessionId: string | null;
  occurredAt: Date;
}

interface FlowMemoryDrawerProps {
  lesson: FlowLesson;
  stepName: string;
  evidenceSessions: DrawerEvidenceSession[];
  isDeciding: boolean;
  onDismiss: () => void;
  onAccept: () => void;
  onReject: () => void;
}

// The expanded state: ~85% of the viewport over a scrim, so the evidence is
// readable without leaving the canvas. Dismissing returns to narrow with the
// canvas viewport and node selection untouched — nothing here writes to the
// graph.
export function FlowMemoryDrawer({
  lesson,
  stepName,
  evidenceSessions,
  isDeciding,
  onDismiss,
  onAccept,
  onReject,
}: FlowMemoryDrawerProps) {
  const isDecided = lesson.status !== "proposed";

  return (
    <div className="absolute inset-0 z-30 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/40"
        aria-label="Close flow memory"
        onClick={onDismiss}
      />
      <aside
        className="relative flex h-full w-[85%] flex-col border-l bg-background shadow-xl"
        role="dialog"
        aria-label="Lesson detail"
      >
        <header className="flex items-start justify-between gap-4 border-b p-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{stepName}</p>
            <h2 className="mt-1 text-base font-medium">
              {lesson.kind === "knowledge_gap" ? "Knowledge gap" : "Suggested guidance"}
            </h2>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Minimise flow memory"
            onClick={onDismiss}
          >
            <Minimize2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto p-4">
          <p className="text-sm leading-relaxed">{lesson.statement}</p>

          {lesson.kind === "knowledge_gap" ? (
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
              Accepting this raises an item for your knowledge base. It is never added to the
              step&apos;s instructions.
            </p>
          ) : null}

          <section>
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Evidence — {evidenceLabel(lesson.evidenceCount)}
            </h3>
            <ul className="mt-2 space-y-1 text-sm">
              {evidenceSessions.map((session, index) => (
                <li key={session.sessionId ?? `deleted-${index}`} className="text-muted-foreground">
                  {session.sessionId ? (
                    <a className="underline underline-offset-2" href={`/chat/${session.sessionId}`}>
                      Chat from {session.occurredAt.toLocaleDateString()}
                    </a>
                  ) : (
                    // Shown rather than hidden: the count and the list must never
                    // silently disagree.
                    <span>Chat from {session.occurredAt.toLocaleDateString()} (since deleted)</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t p-4">
          {isDecided ? (
            <p className="mr-auto text-sm text-muted-foreground">
              You already {lesson.status} this lesson.
            </p>
          ) : null}
          <Button type="button" variant="outline" disabled={isDeciding || isDecided} onClick={onReject}>
            <X className="mr-2 h-4 w-4" aria-hidden="true" />
            Reject
          </Button>
          <Button type="button" disabled={isDeciding || isDecided} onClick={onAccept}>
            Accept
          </Button>
        </footer>
      </aside>
    </div>
  );
}
