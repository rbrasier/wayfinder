"use client";

import { useState } from "react";
import { PanelRightClose } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";
import { FlowMemoryDrawer } from "./flow-memory-drawer";
import {
  EMPTY_STATE_MESSAGE,
  evidenceLabel,
  stateAfterCollapsing,
  stateAfterDismissingDrawer,
  stateAfterOpeningLesson,
  statTiles,
  visibleLessons,
  type FlowMemoryPanelState,
} from "./flow-memory-panel-model";

interface FlowMemoryPanelProps {
  flowId: string;
  state: FlowMemoryPanelState;
  onStateChange: (state: FlowMemoryPanelState) => void;
  nodeNamesById: Record<string, string>;
}

// Mounted only on a published flow: a draft has no live sessions to learn from,
// so the panel is absent rather than empty.
export function FlowMemoryPanel({
  flowId,
  state,
  onStateChange,
  nodeNamesById,
}: FlowMemoryPanelProps) {
  const [openLessonId, setOpenLessonId] = useState<string | null>(null);

  const panelQuery = trpc.flowMemory.panel.useQuery({ flowId });
  const lessonQuery = trpc.flowMemory.lesson.useQuery(
    { lessonId: openLessonId ?? "" },
    { enabled: openLessonId !== null },
  );

  const utils = trpc.useUtils();
  const onDecided = async (message: string) => {
    toast.success(message);
    setOpenLessonId(null);
    onStateChange(stateAfterDismissingDrawer());
    await utils.flowMemory.panel.invalidate({ flowId });
  };

  const accept = trpc.flowMemory.accept.useMutation({
    onSuccess: () => void onDecided("Lesson accepted. It applies from the next turn."),
    onError: (error) => toast.error(error.message),
  });
  const reject = trpc.flowMemory.reject.useMutation({
    onSuccess: () => void onDecided("Lesson rejected."),
    onError: (error) => toast.error(error.message),
  });

  if (state === "hidden") return null;

  const lessons = visibleLessons(panelQuery.data?.lessons ?? []);
  const openLesson = lessonQuery.data;

  return (
    <>
      <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
        <header className="border-b p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Flow memory</h2>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Hide flow memory"
              onClick={() => onStateChange(stateAfterCollapsing())}
            >
              <PanelRightClose className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          {panelQuery.data ? (
            <dl className="mt-3 grid grid-cols-2 gap-2">
              {statTiles(panelQuery.data.stats).map((tile) => (
                <div key={tile.key} className="rounded-md bg-muted p-2">
                  <dt className="text-[11px] text-muted-foreground">{tile.label}</dt>
                  <dd className="text-lg font-medium tabular-nums">{tile.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </header>

        <div className="flex-1 overflow-y-auto p-2">
          {panelQuery.isPending ? (
            <p className="p-2 text-sm text-muted-foreground">Loading…</p>
          ) : null}

          {!panelQuery.isPending && lessons.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">{EMPTY_STATE_MESSAGE}</p>
          ) : null}

          <ul className="space-y-1">
            {lessons.map((lesson) => (
              <li key={lesson.id}>
                <button
                  type="button"
                  className="w-full rounded-md p-2 text-left hover:bg-muted"
                  onClick={() => {
                    setOpenLessonId(lesson.id);
                    onStateChange(stateAfterOpeningLesson());
                  }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {nodeNamesById[lesson.nodeId] ?? "Unknown step"}
                    </span>
                    {lesson.status === "proposed" ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                        {evidenceLabel(lesson.evidenceCount)}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-sm">{lesson.statement}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {state === "expanded" && openLesson ? (
        <FlowMemoryDrawer
          lesson={openLesson.lesson}
          stepName={nodeNamesById[openLesson.lesson.nodeId] ?? "Unknown step"}
          evidenceSessions={openLesson.evidenceSessions}
          isDeciding={accept.isPending || reject.isPending}
          onDismiss={() => {
            setOpenLessonId(null);
            onStateChange(stateAfterDismissingDrawer());
          }}
          onAccept={() => accept.mutate({ lessonId: openLesson.lesson.id })}
          onReject={() => reject.mutate({ lessonId: openLesson.lesson.id })}
        />
      ) : null}
    </>
  );
}
