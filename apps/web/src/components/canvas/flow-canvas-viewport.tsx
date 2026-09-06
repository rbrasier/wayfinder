"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ViewportPortal,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnectEnd,
} from "@xyflow/react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { EDGE_TYPES, NODE_TYPES } from "@/lib/canvas/rf-adapters";
import {
  findDisconnectedNodeIds,
  findForksMissingBranchRule,
  findNextStepAnchor,
  findUnclaimedSignatureSlots,
  type NextStepAnchor,
} from "@/lib/canvas/canvas-guidance";
import { DisconnectedStepsWarning } from "./disconnected-steps-warning";
import { MissingBranchRulesWarning } from "./missing-branch-rules-warning";
import { UnclaimedSignaturesWarning } from "./unclaimed-signatures-warning";

// The shared canvas surface for both the user and admin flow-config screens:
// the React Flow pane (background, controls, minimap) plus the stale-reference
// banner. The two screens differ only in their header/menu, which stays in the
// per-screen files; the pane and its handlers are identical, so they live here.
export function FlowCanvasViewport({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onConnectEnd,
  onNodeClick,
  onNodeDragStop,
  onAddStep,
  onAddNextStep,
  staleReferences,
  memoryToggle,
}: {
  // An overlay affordance pinned above the pane — currently the flow-memory
  // reopen button. Null on screens that have none.
  memoryToggle?: React.ReactNode;
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onConnectEnd: OnConnectEnd;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onNodeDragStop: (event: React.MouseEvent, node: Node) => void;
  onAddStep: () => void;
  onAddNextStep: (anchor: NextStepAnchor) => void;
  staleReferences: string[];
}) {
  const disconnectedCount = useMemo(
    () => findDisconnectedNodeIds(nodes, edges).length,
    [nodes, edges],
  );
  const nextStepAnchor = useMemo(() => findNextStepAnchor(nodes, edges), [nodes, edges]);
  const unclaimedSignatures = useMemo(
    () => findUnclaimedSignatureSlots(nodes, edges),
    [nodes, edges],
  );
  const forksMissingRules = useMemo(
    () => findForksMissingBranchRule(nodes, edges),
    [nodes, edges],
  );

  return (
    <div className="relative flex-1">
      {memoryToggle ? (
        <div className="pointer-events-none absolute right-4 top-4 z-20">{memoryToggle}</div>
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        fitView
        // Cap the fit zoom at 1: fitting a single node otherwise runs up to the
        // default max of 2, which frames one step far too close. At 1 a lone node
        // sits at the same scale as the empty "add your first step" canvas.
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        deleteKeyCode="Backspace"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap zoomable pannable />
        {nextStepAnchor && (
          // Inside the viewport portal the prompt shares the flow's coordinate
          // system, so it pans and zooms with the steps and keeps reading as
          // "the flow continues this way" rather than drifting over the canvas.
          <ViewportPortal>
            <div
              // React Flow turns pointer events off across the whole viewport
              // and lets nodes back in one by one (.react-flow__node), so
              // anything portalled in has to opt back in or it is visible but
              // unclickable. Only the button opts in — the padding either side
              // of it stays transparent so the canvas underneath still drags.
              className="pointer-events-none absolute flex items-center"
              style={{
                height: nextStepAnchor.nodeHeight,
                transform: `translate(${nextStepAnchor.position.x}px, ${nextStepAnchor.position.y}px)`,
              }}
            >
              <Button
                variant="outline"
                onClick={() => onAddNextStep(nextStepAnchor)}
                className="pointer-events-auto border-dashed opacity-70 shadow-sm transition-opacity hover:opacity-100 focus-visible:opacity-100"
              >
                + Create the next step in your workflow
              </Button>
            </div>
          </ViewportPortal>
        )}
      </ReactFlow>
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <Button size="lg" onClick={onAddStep} className="pointer-events-auto px-10 py-4 text-[15px] shadow-lg">
            + Create your first step in your workflow
          </Button>
        </div>
      )}
      {/* One band for every authoring advisory, so a flow with more than one
          problem stacks them rather than overlapping them on the canvas. */}
      <div className="pointer-events-none absolute left-1/2 top-3 z-10 flex w-[calc(100%-2rem)] max-w-[900px] -translate-x-1/2 flex-col gap-2">
        <DisconnectedStepsWarning count={disconnectedCount} />
        <MissingBranchRulesWarning forks={forksMissingRules} />
        <UnclaimedSignaturesWarning slots={unclaimedSignatures} />
      </div>
      {staleReferences.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-[9px] border border-[#e7c200] bg-[#fff8e1] px-4 py-2 text-center text-[12px] text-[#886b00] shadow-md">
          ⚠ Some steps reference data that no longer exists: {staleReferences.join(", ")}. Re-open them to fix.
        </div>
      )}
    </div>
  );
}
