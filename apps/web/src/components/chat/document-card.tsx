"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionDocument } from "@rbrasier/domain";

interface DocumentCardProps {
  messageId: string;
  document: SessionDocument;
  onRegenerate?: (messageId: string) => void;
}

export function DocumentCard({ messageId, document, onRegenerate }: DocumentCardProps) {
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
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="my-3 flex justify-center">
      <div className="w-full max-w-sm rounded-xl border border-indigo-100 bg-white shadow-sm p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-gray-900 truncate">{document.filename}</p>
            {document.summary && (
              <p className="mt-0.5 text-xs text-gray-500 leading-snug line-clamp-2">
                {document.summary}
              </p>
            )}
            <p className="mt-1 text-[10px] text-gray-400">
              Generated {new Date(document.generatedAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          {isUnavailable ? (
            <div className="flex-1 space-y-2">
              <p className="text-xs text-amber-600">
                File no longer available — <span className="italic">DOCUMENT_STORAGE_PATH</span> may
                not be volume-mounted. Phase 4 moves to durable object storage.
              </p>
              {onRegenerate && (
                <Button size="sm" variant="outline" onClick={() => onRegenerate(messageId)} className="w-full">
                  Regenerate
                </Button>
              )}
            </div>
          ) : (
            <Button
              size="sm"
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex-1"
            >
              {isDownloading ? "Downloading…" : "Download"}
            </Button>
          )}
        </div>

        <p
          className="mt-2 text-[10px] text-gray-400 leading-snug"
          title="Documents require DOCUMENT_STORAGE_PATH to be volume-mounted; Phase 4 moves to durable object storage."
        >
          Requires volume-mounted storage · Phase 4 moves to durable object storage
        </p>
      </div>
    </div>
  );
}
