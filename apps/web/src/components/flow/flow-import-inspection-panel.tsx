"use client";

import type { FlowImportInspection } from "@wayfinder/domain";
import { Badge } from "@/components/ui/badge";
import { summariseInspection } from "./flow-import-summary";

interface FlowImportInspectionPanelProps {
  inspection: FlowImportInspection;
}

// What the archive holds and what will not resolve here, shown before a single
// row is written. This is the difference between an import and a surprise
// (ADR-049 §5), so nothing here is collapsed behind a "details" toggle.
export function FlowImportInspectionPanel({ inspection }: FlowImportInspectionPanelProps) {
  const summary = summariseInspection(inspection);

  return (
    <div className="space-y-6" data-testid="flow-import-inspection">
      <section>
        <h3 className="text-base font-semibold">{summary.flowName}</h3>
        {summary.description ? (
          <p className="mt-1 text-sm text-[#5c574c]">{summary.description}</p>
        ) : null}
        <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-[#5c574c]">Steps</dt>
            <dd data-testid="inspection-node-count">{summary.nodeCount}</dd>
          </div>
          <div>
            <dt className="text-[#5c574c]">Bundled files</dt>
            <dd data-testid="inspection-asset-count">{summary.assetCount}</dd>
          </div>
          <div>
            <dt className="text-[#5c574c]">Exported from</dt>
            <dd>{summary.exportedFrom}</dd>
          </div>
        </dl>
      </section>

      {summary.files.length > 0 ? (
        <section>
          <h4 className="text-sm font-medium">Files that will come with it</h4>
          <ul className="mt-2 space-y-1 text-sm">
            {summary.files.map((file) => (
              <li key={file.id} className="flex justify-between gap-4">
                <span className="truncate">{file.filename}</span>
                <span className="shrink-0 text-[#5c574c]">{file.size}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h4 className="text-sm font-medium">What this flow needs from here</h4>

        {summary.needsNothing ? (
          <p className="mt-2 text-sm text-[#5c574c]">
            Nothing — this flow references no skills or MCP tools.
          </p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {summary.found.map((entry) => (
              <li key={entry.key} className="flex items-center gap-2">
                <Badge variant="green">Found</Badge>
                <span>{entry.label}</span>
              </li>
            ))}
            {summary.missing.map((entry) => (
              <li key={entry.key} className="flex items-center gap-2">
                <Badge variant="rose">Missing</Badge>
                <span>{entry.label}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {summary.publishBlocked ? (
        <p className="rounded-[8px] border border-[#f6e9d8] bg-[#fdf8f1] p-3 text-sm" role="status">
          This flow will import as a draft. The {summary.missing.length === 1 ? "step" : "steps"}{" "}
          above will be flagged on the canvas, and the flow cannot be published until you point each
          one at something that exists here.
        </p>
      ) : null}

      {summary.warnings.map((warning) => (
        <p key={warning} className="text-sm text-[#8a5a1d]" role="status">
          {warning}
        </p>
      ))}
    </div>
  );
}
