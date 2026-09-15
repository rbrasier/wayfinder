"use client";

import { useTourBeat } from "../use-tour-beat";
import { Stage } from "./stage";

// A purchase approval laid out as three steps and joined in order. The join
// reuses the drag gesture from the disconnected-steps warning: the pointer
// drags from one step's dot to the next, the connector draws behind it, the
// target dot snaps.
const BEATS = [500, 900, 900, 1100, 900, 1100, 2800] as const;

const NODE_WIDTH = 152;
const NODE_SPACING = 196;
const FIRST_NODE_X = 12;

const NODES = [
  { name: "Gather the background", hint: "Who, what, and why" },
  { name: "Confirm the requirement", hint: "Spec, budget, timing" },
  { name: "Route for approval", hint: "Delegated authority" },
].map((node, index) => ({ ...node, x: FIRST_NODE_X + index * NODE_SPACING }));

const NODE_Y = 74;
const NODE_HEIGHT = 52;
const DOT_Y = NODE_Y + NODE_HEIGHT / 2;
const GAP = NODE_SPACING - NODE_WIDTH;

export function StepsAnimation() {
  const beat = useTourBeat(BEATS);
  return (
    <Stage>
      <svg viewBox="0 0 560 220" className="h-full w-full">
        <defs>
          <pattern id="wf-tour-dots" width="16" height="16" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#ddd8d0" />
          </pattern>
        </defs>
        <rect width="560" height="220" fill="url(#wf-tour-dots)" />

        {NODES.map((node, index) => (
          <g
            key={node.name}
            className="transition-all duration-500 ease-out"
            style={{
              opacity: beat >= index * 2 + 1 ? 1 : 0,
              transform: beat >= index * 2 + 1 ? "translateY(0)" : "translateY(8px)",
            }}
          >
            <rect
              x={node.x}
              y={NODE_Y}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx={8}
              fill="#fff"
              stroke="#c3cee9"
            />
            <rect x={node.x + 10} y={NODE_Y + 12} width={12} height={12} rx={3} fill="#2f56d3" />
            <text x={node.x + 28} y={NODE_Y + 22} fontSize="10.5" fontWeight="600" fill="#1c1b19">
              {node.name}
            </text>
            <text x={node.x + 10} y={NODE_Y + 40} fontSize="9.5" fill="#666055">
              {node.hint}
            </text>
            <circle cx={node.x} cy={DOT_Y} r={4.5} fill="#2f56d3" stroke="#fff" strokeWidth={1.5} />
            <circle
              cx={node.x + NODE_WIDTH}
              cy={DOT_Y}
              r={4.5}
              fill="#2f56d3"
              stroke="#fff"
              strokeWidth={1.5}
            />
          </g>
        ))}

        {[0, 1].map((joinIndex) => {
          const from = NODES[joinIndex];
          const to = NODES[joinIndex + 1];
          if (!from || !to) return null;
          const joined = beat >= joinIndex * 2 + 3;
          const startX = from.x + NODE_WIDTH;
          return (
            <g key={joinIndex}>
              <line
                x1={startX}
                y1={DOT_Y}
                x2={to.x}
                y2={DOT_Y}
                stroke="#2f56d3"
                strokeWidth={2}
                strokeLinecap="round"
                strokeDasharray={GAP}
                className="transition-[stroke-dashoffset] duration-700 ease-in-out"
                style={{ strokeDashoffset: joined ? 0 : GAP }}
              />
              <g
                className="transition-all duration-700 ease-in-out"
                style={{
                  opacity: beat >= joinIndex * 2 + 2 && beat < joinIndex * 2 + 4 ? 1 : 0,
                  transform: `translate(${joined ? to.x : startX}px, ${DOT_Y}px)`,
                }}
              >
                <path
                  d="M0 0 L0 13 L3.4 9.7 L5.8 14.6 L8.6 13.3 L6.2 8.5 L10.2 8 Z"
                  fill="#3f3b34"
                  stroke="#fff"
                  strokeWidth={1}
                  strokeLinejoin="round"
                />
              </g>
              <circle
                cx={to.x}
                cy={DOT_Y}
                r={7}
                fill="none"
                stroke="#2f56d3"
                strokeWidth={1.5}
                className="transition-all duration-300"
                style={{ opacity: joined ? 0.5 : 0, transform: joined ? "scale(1)" : "scale(0.5)", transformBox: "fill-box", transformOrigin: "center" }}
              />
            </g>
          );
        })}
      </svg>
    </Stage>
  );
}
