"use client";

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { unresolvedBadgeModel } from "./unresolved-dependencies";

interface UnresolvedDependenciesBadgeProps {
  config: Record<string, unknown>;
}

// Shown on a node an import could not fully wire up (ADR-049 §4). The flow is
// already unpublishable while this is here; the badge is what tells the author
// which step to open and what it is waiting for.
export function UnresolvedDependenciesBadge({ config }: UnresolvedDependenciesBadgeProps) {
  const model = unresolvedBadgeModel(config);
  if (!model) return null;

  return (
    <Badge variant="amber" title={model.title} data-testid="unresolved-dependencies-badge">
      <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
      {model.label}
    </Badge>
  );
}
