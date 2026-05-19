import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon?: ReactNode;
  heading: string;
  body: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export function EmptyState({ icon, heading, body, ctaLabel, onCta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-24 text-center text-muted-foreground">
      {icon && <div className="text-4xl">{icon}</div>}
      <p className="text-lg font-medium text-foreground">{heading}</p>
      <p className="max-w-sm text-sm">{body}</p>
      {ctaLabel && onCta && (
        <Button onClick={onCta}>{ctaLabel}</Button>
      )}
    </div>
  );
}
