"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  readPanelState,
  writePanelState,
  type FlowMemoryPanelState,
} from "@/components/canvas/flow-memory-panel-model";

// Panel state, persisted per user per flow. Read on mount and written on every
// transition; the model handles a storage that is absent or throws, so this hook
// stays a plain state holder.
export interface NamedCanvasNode {
  id: string;
  data?: { name?: unknown };
}

export function useFlowMemoryPanel(
  flowId: string,
  nodes: NamedCanvasNode[],
  flowStatus: "draft" | "published",
) {
  const [state, setState] = useState<FlowMemoryPanelState>("narrow");

  const store = () => (typeof window === "undefined" ? null : window.localStorage);

  useEffect(() => {
    setState(readPanelState(store(), flowId));
  }, [flowId]);

  const changeState = useCallback(
    (next: FlowMemoryPanelState) => {
      setState(next);
      writePanelState(store(), flowId, next);
    },
    [flowId],
  );

  // The panel names a lesson's step; the canvas already holds those names.
  const nodeNamesById = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, String(node.data?.name ?? "Unknown step")])),
    [nodes],
  );

  // Everything the canvas region needs to render the panel, as one object, so
  // the config screen passes a single prop rather than five.
  // Only a published flow has sessions to learn from.
  return { flowId, state, changeState, nodeNamesById, isPublished: flowStatus === "published" };
}
