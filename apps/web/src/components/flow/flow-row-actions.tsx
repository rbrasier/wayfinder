"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface FlowRowActionsProps {
  flowId: string;
  flowName: string;
  onDuplicate: (flowId: string) => Promise<void>;
}

// Export is a plain link, not a fetch: the browser's own download handling is
// what turns the response into a saved file, and routing it through JavaScript
// would mean buffering the whole archive in the page to no benefit.
export function FlowRowActions({ flowId, flowName, onDuplicate }: FlowRowActionsProps) {
  const [duplicating, setDuplicating] = useState(false);

  const duplicate = async (): Promise<void> => {
    setDuplicating(true);
    try {
      await onDuplicate(flowId);
    } finally {
      setDuplicating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button asChild variant="ghost" size="sm">
        <a href={`/api/flows/${flowId}/export`} download aria-label={`Export ${flowName}`}>
          Export
        </a>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => void duplicate()}
        disabled={duplicating}
        aria-label={`Duplicate ${flowName}`}
      >
        {duplicating ? "Duplicating…" : "Duplicate"}
      </Button>
    </div>
  );
}
