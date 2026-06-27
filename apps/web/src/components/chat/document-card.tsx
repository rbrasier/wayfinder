"use client";

import { useState } from "react";
import { FileText, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DocumentGenerationConfidence, SessionDocument } from "@rbrasier/domain";
import { DocumentInfoModal } from "./document-info-modal";
import { DocumentEditDialog } from "./document-edit-dialog";

interface DocumentCardProps {
  messageId: string;
  document: SessionDocument;
  documentGenerationConfidence?: DocumentGenerationConfidence | null;
  // When the node permits manual edits and the session is still editable.
  canEdit?: boolean;
  onEdited?: () => void;
  onRegenerate?: (messageId: string) => void;
}

export function DocumentCard({
  messageId,
  document,
  documentGenerationConfidence,
  canEdit = false,
  onEdited,
  onRegenerate,
}: DocumentCardProps) {
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const res = await fetch(`/api/documents/${messageId}`);
      if (res.status === 410) {
        setIsUnavailable(true);
        return;
      }
      if (!res.ok) return;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = document.filename;
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
      <div className="relative w-full max-w-sm rounded-[10px] border border-[#dedad2] bg-white p-[12px_14px] shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]">
        {documentGenerationConfidence && (
          <DocumentInfoModal confidence={documentGenerationConfidence} />
        )}
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#eef1fc] text-[#3a5fd9]">
            <FileText className="h-[18px] w-[18px] stroke-[1.8]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-[#1a1814]">{document.filename}</p>
            {document.summary && (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[#6d6a65]">
                {document.summary}
              </p>
            )}
            <p className="mt-1 font-mono text-[10px] text-[#6d6a65]">
              Generated {new Date(document.generatedAt).toLocaleDateString()}
            </p>
            {document.editedAt && (
              <p className="mt-0.5 text-[10px] font-medium text-[#9b6215]">
                Edited {new Date(document.editedAt).toLocaleDateString()}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {isUnavailable ? (
            <div className="flex-1 space-y-2">
              <p className="text-[12px] text-[#9b6215]">File no longer available. Try regenerating.</p>
              {onRegenerate && (
                <Button size="sm" variant="secondary" onClick={handleRegenerate} className="w-full">
                  Regenerate
                </Button>
              )}
            </div>
          ) : (
            <>
              <Button size="sm" onClick={handleDownload} disabled={isDownloading} className="flex-1">
                {isDownloading ? "Downloading…" : "↓ Download"}
              </Button>
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
