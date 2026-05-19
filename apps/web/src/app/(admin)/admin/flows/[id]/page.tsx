"use client";

import { Background, BackgroundVariant, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export default function FlowCanvasPage() {
  return (
    <div style={{ width: "100%", height: "calc(100vh - 56px)" }}>
      <ReactFlow nodes={[]} edges={[]} fitView>
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      </ReactFlow>
    </div>
  );
}
