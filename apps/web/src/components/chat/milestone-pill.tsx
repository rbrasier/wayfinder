interface MilestonePillProps {
  nodeName: string;
  confidence: number;
  isDocumentNode?: boolean;
}

export function MilestonePill({ nodeName, confidence, isDocumentNode = false }: MilestonePillProps) {
  if (isDocumentNode) {
    return (
      <div className="my-3 flex justify-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
          <span>📄</span>
          <span>Document generation coming in v1.4.0</span>
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
