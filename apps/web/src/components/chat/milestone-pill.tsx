interface MilestonePillProps {
  nodeName: string;
  confidence: number;
  documentState?: "generating" | "no_template" | "failed" | "done" | null;
  onRegenerate?: () => void;
}

function Spinner() {
  return (
    <svg
      className="h-3 w-3 animate-spin shrink-0"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
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
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#dedad2] bg-[#efede8] px-3 py-1 text-[11px] font-semibold text-[#6d6a65]">
          <span>📄</span>
          <span>Step complete — {nodeName} · No template configured</span>
        </div>
      </div>
    );
  }

  if (documentState === "failed") {
    return (
      <div className="my-3 flex flex-col items-center gap-1">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#e8b87c] bg-[#fdf3e3] px-3 py-1 text-[11px] font-semibold text-[#9b6215]">
          <span>⚠️</span>
          <span>Document generation failed — {nodeName}</span>
          {onRegenerate && (
            <button type="button" className="ml-1 underline hover:no-underline" onClick={onRegenerate}>
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
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#c5d0f7] bg-[#eef1fc] px-3 py-1 text-[11px] font-semibold text-[#3a5fd9]">
          <Spinner />
          <span>Generating document — {nodeName}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="my-3 flex justify-center">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-[#c0e8d5] bg-[#eaf6f0] px-3 py-[4px] text-[11px] font-semibold text-[#247c53]">
        <svg viewBox="0 0 12 12" width="12" height="12" className="shrink-0">
          <circle cx="6" cy="6" r="6" fill="currentColor" />
          <path d="M3.5 6l2 2 3-3" stroke="white" strokeWidth="1.2" fill="none" />
        </svg>
        <span>
          Step complete — {nodeName} ({confidence}%)
        </span>
      </div>
    </div>
  );
}

export function FlowCompletePill() {
  return (
    <div className="my-4 flex justify-center">
      <div className="inline-flex items-center gap-2 rounded-full border border-[#c0e8d5] bg-[#eaf6f0] px-4 py-[6px] text-[12px] font-semibold text-[#247c53]">
        <svg viewBox="0 0 16 16" width="16" height="16" className="shrink-0">
          <circle cx="8" cy="8" r="8" fill="currentColor" />
          <path d="M4.5 8l2.5 2.5 4.5-4.5" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Flow complete</span>
      </div>
    </div>
  );
}
