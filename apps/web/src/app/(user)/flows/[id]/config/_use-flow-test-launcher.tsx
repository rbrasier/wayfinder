"use client";

import { useCallback, useState, type ReactElement } from "react";
import type { Node } from "@xyflow/react";
import { FlowTestModal } from "@/components/canvas/flow-test-modal";

export interface FlowTestLauncher {
  // Runs the whole flow from its root.
  openFlowTest: () => void;
  // Runs one step, with everything before it simulated.
  openStepTest: (nodeId: string) => void;
  modal: ReactElement;
}

// The canvas has two entry points into the same modal — the toolbar and a
// step's editor — so the scope lives here rather than in either caller. A
// whole-flow run is a step test at the root with an empty seed, which is why
// `startNodeId: null` is a scope and not a second mode.
export function useFlowTestLauncher(flowId: string, nodes: Node[]): FlowTestLauncher {
  const [open, setOpen] = useState(false);
  const [nodeId, setNodeId] = useState<string | null>(null);

  const openFlowTest = useCallback(() => {
    setNodeId(null);
    setOpen(true);
  }, []);

  const openStepTest = useCallback((stepNodeId: string) => {
    setNodeId(stepNodeId);
    setOpen(true);
  }, []);

  const startNodeName = nodeId
    ? ((nodes.find((node) => node.id === nodeId)?.data.name as string | undefined) ?? null)
    : null;

  const modal = (
    <FlowTestModal
      open={open}
      flowId={flowId}
      startNodeId={nodeId}
      startNodeName={startNodeName}
      onClose={() => setOpen(false)}
    />
  );

  return { openFlowTest, openStepTest, modal };
}
