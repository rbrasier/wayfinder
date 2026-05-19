"use client";

interface ConfidenceBarProps {
  score: number | null;
  evaluating?: boolean;
}

export function ConfidenceBar({ score, evaluating = false }: ConfidenceBarProps) {
  if (evaluating || score === null) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 w-24 animate-pulse rounded-full bg-gray-200" />
        <span className="font-mono text-xs text-muted-foreground">Evaluating…</span>
      </div>
    );
  }

  const colour =
    score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-gray-400";

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colour}`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className="font-mono text-xs text-muted-foreground">{score}%</span>
    </div>
  );
}
