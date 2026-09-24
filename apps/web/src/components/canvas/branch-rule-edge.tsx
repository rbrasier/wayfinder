"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useStore,
  type EdgeProps,
} from "@xyflow/react";
import { isForkedEdge } from "@/lib/canvas/canvas-guidance";
import { BranchRuleIcon } from "./branch-rule-icon";

// What the canvas puts on each edge so the badge can render and the modal can
// open pre-filled. `onOpenRule` is handed down per-edge by the config screen
// rather than read from a context, because the modal state lives up there.
export interface BranchRuleEdgeData extends Record<string, unknown> {
  branchRule?: string;
  onOpenRule?: (edgeId: string) => void;
}

// Every edge renders through this component, forked or not: React Flow resolves
// one component per edge `type`, and the fork test depends on sibling edges that
// only the store knows. An unforked edge gets the plain smoothstep edge it had
// before branch rules existed.
export function BranchRuleEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Subscribed through the store rather than passed in, so the badge appears the
  // moment a second edge is drawn out of the same step without the canvas having
  // to re-map every edge.
  const isFork = useStore((store) =>
    isForkedEdge({ source, target }, [...store.edges.values()].map((edge) => ({
      source: edge.source,
      target: edge.target,
    }))),
  );

  const edgeData = data as BranchRuleEdgeData | undefined;
  const rule = edgeData?.branchRule?.trim();
  const openRule = edgeData?.onOpenRule;

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      {isFork && openRule && (
        <EdgeLabelRenderer>
          {/* The renderer's layer has pointer events off; `nodrag nopan` plus
              `pointer-events-auto` is what lets the badge be clicked without the
              canvas panning underneath it. */}
          <button
            type="button"
            className="nodrag nopan pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-full border border-[#c3cee9] bg-white shadow-sm transition-transform hover:scale-110 focus-visible:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wf-primary"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={(event) => {
              event.stopPropagation();
              openRule(id);
            }}
            data-branch-rule-edge={id}
            data-branch-rule-state={rule ? "set" : "missing"}
            title={rule ? `Take this branch when: ${rule}` : "No rule set — click to add one"}
            aria-label={
              rule
                ? `Edit the rule for this branch. Currently: take this branch when ${rule}`
                : "This branch has no rule. Click to add one."
            }
          >
            <BranchRuleIcon state={rule ? "set" : "missing"} className="h-3.5 w-3.5" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
