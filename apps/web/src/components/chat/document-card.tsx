"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
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
      toast.success("Downloading…");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="my-3 flex justify-center">
      <div className="w-full max-w-sm rounded-xl border border-primary/10 bg-white shadow-sm p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{document.filename}</p>
            {document.summary && (
              <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-gray-500">
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
                File no longer available. Try regenerating.
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
      </div>
    </div>
  );
}
