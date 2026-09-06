"use client";

import type { ComponentProps } from "react";
import { FlowCanvasViewport } from "@/components/canvas/flow-canvas-viewport";
import { FlowMemoryPanel } from "@/components/canvas/flow-memory-panel";
import { FlowMemoryToggle } from "@/components/canvas/flow-memory-toggle";
import { stateAfterReopening } from "@/components/canvas/flow-memory-panel-model";
import { useFlowMemoryPanel } from "./_use-flow-memory-panel";

type ViewportProps = Omit<ComponentProps<typeof FlowCanvasViewport>, "memoryToggle">;

interface CanvasRegionProps extends ViewportProps {
  flow: { id: string; status: "draft" | "published" };
}

// The canvas and the flow-memory panel beside it. Split out of `_content.tsx`
// so that file stays under the size guard, and because the pairing — pane,
// overlay affordance, right-hand rail — is one layout concern.
export function CanvasRegion({ flow, ...viewportProps }: CanvasRegionProps) {
  // The panel's state lives here rather than on the config screen: nothing above
  // this component reads it, and the screen is already at the size guard.
  // A draft shows neither the panel nor the affordance that reopens it.
  const memory = useFlowMemoryPanel(flow.id, viewportProps.nodes, flow.status);
  const { isPublished, state, changeState } = memory;

  return (
    // FlowCanvasViewport's own root is `relative flex-1` — it is already the
    // canvas column, so it goes straight into the row. An extra wrapper here
    // covered the pane and swallowed clicks on branch-rule indicators: it was
    // not a flex container, so the viewport's flex-1 did nothing and the wrapper
    // stretched over it.
    <div className="flex min-h-0 flex-1">
      <FlowCanvasViewport
        {...viewportProps}
        memoryToggle={
          isPublished && state === "hidden" ? (
            <FlowMemoryToggle
              proposedCount={0}
              onReopen={() => changeState(stateAfterReopening())}
            />
          ) : null
        }
      />

      {isPublished ? (
        <FlowMemoryPanel
          flowId={flow.id}
          state={state}
          onStateChange={changeState}
          nodeNamesById={memory.nodeNamesById}
        />
      ) : null}
    </div>
  );
}
