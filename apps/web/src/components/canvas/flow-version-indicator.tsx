import { Badge } from "@/components/ui/badge";

interface FlowVersionIndicatorProps {
  hasUnpublishedChanges: boolean;
  latestPublishedNumber: number | null;
}

// Sits to the left of the flow's published-state badge once a flow has at least
// one published version. It tells the author which version they are editing —
// an unpublished draft or the live published version — and, after a separator,
// which version is currently published.
export function FlowVersionIndicator({
  hasUnpublishedChanges,
  latestPublishedNumber,
}: FlowVersionIndicatorProps) {
  if (latestPublishedNumber === null) return null;

  return (
    <div className="flex items-center gap-2">
      <Badge variant={hasUnpublishedChanges ? "secondary" : "default"}>
        {hasUnpublishedChanges
          ? "Draft · unpublished"
          : `Version ${latestPublishedNumber} · published`}
      </Badge>
      <div className="h-4 w-px bg-border" />
      <span className="text-[12px] text-[#5a5650]">Published: Version {latestPublishedNumber}</span>
    </div>
  );
}
