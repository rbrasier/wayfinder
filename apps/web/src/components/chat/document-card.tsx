"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { DocumentGenerationConfidence, SessionDocument } from "@rbrasier/domain";
import { DocumentInfoModal } from "./document-info-modal";

interface DocumentCardProps {
  messageId: string;
  document: SessionDocument;
  documentGenerationConfidence?: DocumentGenerationConfidence | null;
  onRegenerate?: (messageId: string) => void;
}

export function DocumentCard({
  messageId,
  document,
  documentGenerationConfidence,
  onRegenerate,
}: DocumentCardProps) {
  const [isUnavailable, setIsUnavailable] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

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
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[#918d87]">
                {document.summary}
              </p>
            )}
            <p className="mt-1 font-mono text-[10px] text-[#918d87]">
              Generated {new Date(document.generatedAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {isUnavailable ? (
            <div className="flex-1 space-y-2">
              <p className="text-[12px] text-[#c17a1a]">File no longer available. Try regenerating.</p>
              {onRegenerate && (
                <Button size="sm" variant="secondary" onClick={() => onRegenerate(messageId)} className="w-full">
                  Regenerate
                </Button>
              )}
            </div>
          ) : (
            <Button size="sm" onClick={handleDownload} disabled={isDownloading} className="flex-1">
              {isDownloading ? "Downloading…" : "↓ Download"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
