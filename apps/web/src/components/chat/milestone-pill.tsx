interface MilestonePillProps {
  nodeName: string;
  confidence: number;
  documentState?: "generating" | "no_template" | "failed" | "done" | null;
  onRegenerate?: () => void;
}

export function MilestonePill({
  nodeName,
  confidence,
  documentState,
  onRegenerate,
}: MilestonePillProps) {
  if (documentState === "no_template") {
    return (
      <div className="my-3 flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-500">
          <span>📄</span>
          <span>Step complete — {nodeName} · No template configured</span>
        </div>
      </div>
    );
  }

  if (documentState === "failed") {
    return (
      <div className="my-3 flex flex-col items-center gap-1">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
          <span>⚠️</span>
          <span>Document generation failed — {nodeName}</span>
          {onRegenerate && (
            <button
              type="button"
              className="ml-1 underline hover:no-underline"
              onClick={onRegenerate}
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  if (documentState === "generating") {
    return (
      <div className="my-3 flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs text-indigo-700">
          <span className="animate-pulse">📄</span>
          <span>Generating document — {nodeName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-3 flex justify-center">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
        <span>✓</span>
        <span>
          Step complete — {nodeName} ({confidence}%)
        </span>
      </div>
    </div>
  );
}
