"use client";

import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FlowMemoryToggleProps {
  proposedCount: number;
  onReopen: () => void;
}

// The reopen affordance for a hidden panel: one icon button pinned to the top
// right of the canvas viewport. Rendered only while the panel is hidden, so it
// never competes with the panel it opens.
export function FlowMemoryToggle({ proposedCount, onReopen }: FlowMemoryToggleProps) {
  const label =
    proposedCount > 0
      ? `Show flow memory (${proposedCount} awaiting a decision)`
      : "Show flow memory";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="pointer-events-auto relative shadow-sm"
      aria-label={label}
      title={label}
      onClick={onReopen}
    >
      <Brain className="h-4 w-4" aria-hidden="true" />
      {proposedCount > 0 ? (
        <span
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground"
          aria-hidden="true"
        >
          {proposedCount}
        </span>
      ) : null}
    </Button>
  );
}
