"use client";

import { useState } from "react";
import { FileText, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DocumentGenerationConfidence, SessionDocument } from "@wayfinder/domain";
import { DocumentInfoModal } from "./document-info-modal";
import { DocumentEditDialog } from "./document-edit-dialog";
import { DocumentEditHistoryModal } from "./document-edit-history-modal";
import { SignaturesPanel } from "@/components/signatures/signatures-panel";

interface DocumentCardProps {
  messageId: string;
  document: SessionDocument;
  documentGenerationConfidence?: DocumentGenerationConfidence | null;
  // When the node permits manual edits and the session is still editable.
  canEdit?: boolean;
  onEdited?: () => void;
  onRegenerate?: (messageId: string) => void;
  // Set where the card can show the signatures panel for its session.
  sessionId?: string;
}

export function DocumentCard({
  messageId,
  document,
  documentGenerationConfidence,
  canEdit = false,
  onEdited,
  onRegenerate,
  sessionId,
}: DocumentCardProps) {
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const handleDownload = async (format: "original" | "pdf" = "original") => {
    setIsDownloading(true);
    try {
      const res = await fetch(`/api/documents/${messageId}${format === "pdf" ? "?format=pdf" : ""}`);
      if (res.status === 410) {
        setIsUnavailable(true);
        return;
      }
      if (!res.ok) return;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = format === "pdf" ? document.filename.replace(/\.[a-z0-9]+$/i, "") + ".pdf" : document.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloading…");
    } finally {
      setIsDownloading(false);
    }
  };

  // Regenerate is a rewrite from the conversation that overrides manual edits;
  // warn before discarding the operator's corrections.
  const handleRegenerate = () => {
    if (!onRegenerate) return;
    if (document.editedAt) {
      const confirmed = window.confirm(
        "Regenerating rewrites this document from the conversation and overrides your manual edits (the edit history is kept). Continue?",
      );
      if (!confirmed) return;
    }
    onRegenerate(messageId);
  };

  return (
    <div className="my-3 flex justify-center">
      <div className="relative w-full max-w-sm rounded-[10px] border border-[#e7e3db] bg-white p-[12px_14px] shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]">
        {documentGenerationConfidence && (
          <DocumentInfoModal confidence={documentGenerationConfidence} />
        )}
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-wf-primary-light text-wf-primary">
            <FileText className="h-[18px] w-[18px] stroke-[1.8]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[#1c1b19]">{document.filename}</p>
            {document.summary && (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[#666055]">
                {document.summary}
              </p>
            )}
            <p className="mt-1 font-mono text-[10px] text-[#666055]">
              Generated {new Date(document.generatedAt).toLocaleDateString()}
            </p>
            {document.pdf?.status === "failed" && (
              <p className="mt-0.5 text-[10px] font-medium text-[#8a5a1d]" data-testid="document-pdf-failed">
                PDF not produced: {document.pdf.failureReason ?? "conversion failed"}
              </p>
            )}
            {document.pdf?.status === "frozen" && (
              <p className="mt-0.5 text-[10px] font-medium text-[#1f6b4d]">Signed PDF — no longer editable</p>
            )}
            {document.editedAt && (
              <div className="mt-0.5 flex items-center gap-1">
                <p className="text-[10px] font-medium text-[#8a5a1d]">
                  Edited {new Date(document.editedAt).toLocaleDateString()}
                </p>
                <DocumentEditHistoryModal messageId={messageId} />
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {isUnavailable ? (
            <div className="flex-1 space-y-2">
              <p className="text-[12px] text-[#8a5a1d]">File no longer available. Try regenerating.</p>
              {onRegenerate && (
                <Button size="sm" variant="secondary" onClick={handleRegenerate} className="w-full">
                  Regenerate
                </Button>
              )}
            </div>
          ) : (
            <>
              <Button size="sm" onClick={() => void handleDownload()} disabled={isDownloading} className="flex-1">
                {isDownloading ? "Downloading…" : "↓ Download"}
              </Button>
              {document.pdf?.storagePath && document.pdf.status !== "superseded" && (
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="document-download-pdf"
                  onClick={() => void handleDownload("pdf")}
                  disabled={isDownloading}
                  className="shrink-0"
                >
                  ↓ PDF
                </Button>
              )}
              {canEdit && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setIsEditOpen(true)}
                  className="shrink-0"
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  Edit
                </Button>
              )}
            </>
          )}
        </div>
        {sessionId && document.pdf?.status === "frozen" && <SignaturesPanel sessionId={sessionId} />}
      </div>

      {canEdit && (
        <DocumentEditDialog
          open={isEditOpen}
          messageId={messageId}
          onClose={() => setIsEditOpen(false)}
          onSaved={() => onEdited?.()}
        />
      )}
    </div>
  );
}
