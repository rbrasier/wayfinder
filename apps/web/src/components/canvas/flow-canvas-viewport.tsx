"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnectEnd,
} from "@xyflow/react";
import { NODE_TYPES } from "@/lib/canvas/rf-adapters";

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
  staleReferences,
}: {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onConnectEnd: OnConnectEnd;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onNodeDragStop: (event: React.MouseEvent, node: Node) => void;
  staleReferences: string[];
}) {
  return (
    <div className="relative flex-1">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        fitView
        deleteKeyCode="Backspace"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls />
        <MiniMap zoomable pannable />
      </ReactFlow>
      {staleReferences.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[90%] -translate-x-1/2 rounded-[9px] border border-[#e7c200] bg-[#fff8e1] px-4 py-2 text-center text-[12px] text-[#886b00] shadow-md">
          ⚠ Some steps reference data that no longer exists: {staleReferences.join(", ")}. Re-open them to fix.
        </div>
      )}
    </div>
  );
}
