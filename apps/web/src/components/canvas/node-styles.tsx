import { MessageSquare, Timer, Zap } from "lucide-react";

export type StepType = "conversational" | "auto" | "scheduled";

// Per-type accent colours, shared between the canvas nodes and the config
// modal so a step's type reads the same everywhere: conversational = blue,
// automated (n8n) = purple, scheduled = green.
export const STEP_TYPE_ACCENT: Record<StepType, string> = {
  conversational: "#3a5fd9",
  auto: "#7c3aed",
  scheduled: "#1f8a4c",
};

const ICONS = {
  conversational: MessageSquare,
  auto: Zap,
  scheduled: Timer,
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
