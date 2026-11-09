"use client";

import { useState } from "react";
import { toast } from "sonner";
import { SIGNATURE_FAILURE_MESSAGES, type SignatureBadge } from "@wayfinder/domain";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";

const BADGE_COPY: Record<SignatureBadge, { label: string; className: string }> = {
  valid: { label: "Valid", className: "bg-[#effaf4] text-[#1f6b4d] border-[#bfe0cf]" },
  "valid-but-expired": { label: "Valid — certificate since expired", className: "bg-[#f4f7fb] text-[#2d4f7c] border-[#c9d7ea]" },
  "invalid-modified": { label: "Invalid — document modified", className: "bg-[#fdf0ef] text-[#9b2c22] border-[#efc5c0]" },
  unverifiable: { label: "Unverifiable", className: "bg-[#fff7ea] text-[#8a5a1d] border-[#f1d3a8]" },
};

const formatTime = (iso: string | null): string => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "—");

const download = (filename: string, content: string, type: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

// Who signed a session's documents, with what certificate and when, and
// whether each signature still validates (PRD §3). Re-checking runs the engine
// against the document as it stands now.
export function SignaturesPanel({ sessionId }: { sessionId: string }) {
  const utils = trpc.useUtils();
  const signatures = trpc.signatures.listForSession.useQuery({ sessionId });
  const revalidate = trpc.signatures.revalidate.useMutation({
    onSuccess: async () => {
      await utils.signatures.listForSession.invalidate({ sessionId });
      toast.success("Signatures re-checked");
    },
    onError: (error) => toast.error(error.message ?? "Could not re-check signatures"),
  });
  const exportMetadata = trpc.signatures.exportMetadata.useMutation({
    onError: (error) => toast.error(error.message ?? "Could not export"),
  });
  const [open, setOpen] = useState(true);

  const entries = signatures.data ?? [];
  if (entries.length === 0) return null;

  const exportAs = async (format: "csv" | "json") => {
    const result = await exportMetadata.mutateAsync({ sessionId });
    if (format === "csv") download(`signatures-${sessionId}.csv`, result.csv, "text/csv");
    else download(`signatures-${sessionId}.json`, JSON.stringify(result.records, null, 2), "application/json");
  };

  return (
    <div className="mt-3 rounded-[10px] border border-[#e7e3db] bg-[#faf9f7] p-3" data-testid="signatures-panel">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#666055]"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          Signatures ({entries.length})
        </button>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => revalidate.mutate({ sessionId })} disabled={revalidate.isPending}>
            {revalidate.isPending ? "Checking…" : "Re-check"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void exportAs("csv")} disabled={exportMetadata.isPending}>
            CSV
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void exportAs("json")} disabled={exportMetadata.isPending}>
            JSON
          </Button>
        </div>
      </div>
      {open && (
        <ul className="mt-2 space-y-2">
          {entries.map((entry) => {
            const badge = entry.validation ? BADGE_COPY[entry.validation.badge] : null;
            const reason = entry.validation?.reason ?? entry.rejectionReason;
            return (
              <li
                key={entry.approvalId}
                data-signature-status={entry.status}
                data-signature-badge={entry.validation?.badge ?? ""}
                className="rounded-[8px] border border-[#ece8e0] bg-white p-2 text-[12px]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-[#1c1b19]">{entry.signedBy ?? "Not signed"}</p>
                    <p className="text-[#666055]">
                      {entry.stepName}
                      {entry.method === "off_system" ? " · recorded off system" : ""}
                    </p>
                  </div>
                  {badge ? (
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  ) : (
                    <span className="rounded-full border border-[#f1d3a8] bg-[#fff7ea] px-2 py-0.5 text-[11px] font-medium text-[#8a5a1d]">
                      {entry.status === "rejected" ? "Refused" : "In progress"}
                    </span>
                  )}
                </div>
                {entry.certificate && (
                  <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[11px] text-[#666055]">
                    <dt>Signed</dt>
                    <dd>{formatTime(entry.signedAt)}</dd>
                    <dt>Timestamp</dt>
                    <dd>{formatTime(entry.timestampTime)}</dd>
                    <dt>Certificate</dt>
                    <dd className="break-all">{entry.certificate.subject}</dd>
                    <dt>Issuer</dt>
                    <dd className="break-all">{entry.certificate.issuer}</dd>
                    <dt>Level</dt>
                    <dd>{entry.level?.replace("PAdES_BASELINE_", "PAdES B-") ?? "—"}</dd>
                    <dt>Checked</dt>
                    <dd>{formatTime(entry.validation?.checkedAt ?? null)}</dd>
                  </dl>
                )}
                {reason && <p className="mt-1 text-[11px] text-[#8a5a1d]">{SIGNATURE_FAILURE_MESSAGES[reason]}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
