import { Mail, MessageSquare, Plug, Sparkles, Stamp, Timer, Zap } from "lucide-react";
import { DATA_INDIGO } from "@/lib/data-colours";

export type StepType = "conversational" | "auto" | "scheduled" | "approval" | "mcp" | "ai_task" | "email";

// Per-type accent colours, shared between the canvas nodes and the config
// modal so a step's type reads the same everywhere: conversational = blue,
// automated (n8n) = purple, scheduled = green, approval = amber, MCP = teal,
// AI task = plum, email = slate blue.
export const STEP_TYPE_ACCENT: Record<StepType, string> = {
  conversational: DATA_INDIGO,
  auto: "#5b3fa8",
  scheduled: "#1f6b4d",
  approval: "#d97706",
  mcp: "#14312e",
  ai_task: "#9d3f8a",
  email: "#2f6f8f",
};

const ICONS = {
  conversational: MessageSquare,
  auto: Zap,
  scheduled: Timer,
  approval: Stamp,
  mcp: Plug,
  ai_task: Sparkles,
  email: Mail,
} as const;

// A small type icon pinned to a node's top-right corner.
export function NodeTypeBadge({ type }: { type: StepType }) {
  const Icon = ICONS[type];
  const accent = STEP_TYPE_ACCENT[type];
  return (
    <div
      aria-hidden
      className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-md"
      style={{ backgroundColor: `${accent}1a`, color: accent }}
    >
      <Icon size={12} />
    </div>
  );
}
