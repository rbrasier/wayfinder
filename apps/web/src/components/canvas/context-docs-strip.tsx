"use client";

import { useMemo, useRef, useState } from "react";
import type { FlowContextDoc } from "@rbrasier/domain";
import {
  CONTEXT_DOCS_ALLOWED_MIME_TYPES,
  CONTEXT_DOCS_MAX_FILE_SIZE_BYTES,
  CONTEXT_DOCS_TOTAL_BUDGET_CHARS,
  CONTEXT_DOCS_WARNING_THRESHOLD_CHARS,
} from "@rbrasier/shared";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";

const FILE_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "text/plain": "TXT",
  "text/markdown": "MD",
};

const MAX_FILE_SIZE_MB = CONTEXT_DOCS_MAX_FILE_SIZE_BYTES / (1024 * 1024);

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatChars = (chars: number): string => `${chars.toLocaleString()} chars`;

interface ContextDocsStripProps {
  flowId: string;
  docs: FlowContextDoc[];
  onDocsChange: (docs: FlowContextDoc[]) => void;
}

export function ContextDocsStrip({ flowId, docs, onDocsChange }: ContextDocsStripProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const totalChars = useMemo(
    () => docs.reduce((sum, doc) => sum + (doc.extractedText?.length ?? 0), 0),
    [docs],
  );
  const pctUsed = Math.min(100, Math.round((totalChars / CONTEXT_DOCS_TOTAL_BUDGET_CHARS) * 100));
  const isOverBudget = totalChars > CONTEXT_DOCS_TOTAL_BUDGET_CHARS;
  const isLarge = totalChars >= CONTEXT_DOCS_WARNING_THRESHOLD_CHARS;
  const barColor = isOverBudget
    ? "bg-red-500"
    : isLarge
      ? "bg-amber-500"
      : "bg-emerald-500";
  const textColor = isOverBudget
    ? "text-red-600"
    : isLarge
      ? "text-amber-700"
      : "text-gray-600";

  const removeMutation = trpc.flow.contextDoc.remove.useMutation({
    onSuccess: (_, variables) => {
      onDocsChange(docs.filter((d) => d.id !== variables.docId));
    },
  });

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > CONTEXT_DOCS_MAX_FILE_SIZE_BYTES) {
      setUploadError(`File exceeds ${MAX_FILE_SIZE_MB} MB limit.`);
      return;
    }

    if (!CONTEXT_DOCS_ALLOWED_MIME_TYPES.includes(file.type as never)) {
      setUploadError("Only PDF, DOCX, TXT, and Markdown files are supported.");
      return;
    }

    setUploadError(null);
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`/api/flows/${flowId}/context-docs`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        setUploadError(data.error ?? "Upload failed.");
        return;
      }

      const doc = (await response.json()) as FlowContextDoc;
      onDocsChange([...docs, doc]);
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const warningMessage = isOverBudget
    ? "Context exceeds the flow's budget — uploads will be rejected until you remove or shrink a doc."
    : isLarge
      ? "Large context — every chat turn caches this prefix, so subsequent turns are cheap, but the first turn of each 5-minute window pays the full cost."
      : null;

  return (
    <div className="border-t bg-white px-4 py-3">
      <div className="flex items-center gap-4">
        <span className="shrink-0 text-sm font-medium text-gray-700">Context docs</span>

        <div className="flex flex-1 items-center gap-2 overflow-x-auto">
          {docs.map((doc) => {
            const extractedChars = doc.extractedText?.length ?? 0;
            return (
              <div
                key={doc.id}
                className="flex shrink-0 items-center gap-2 rounded-md border bg-gray-50 px-3 py-1.5"
              >
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                  {FILE_TYPE_LABELS[doc.mimeType] ?? "FILE"}
                </span>
                <span className="max-w-[160px] truncate text-xs text-gray-700">{doc.filename}</span>
                <span className="text-xs text-gray-400">
                  {formatBytes(doc.sizeBytes)} · {formatChars(extractedChars)}
                </span>
                <button
                  type="button"
                  className="text-gray-400 hover:text-red-500"
                  onClick={() => removeMutation.mutate({ flowId, docId: doc.id })}
                  disabled={removeMutation.isPending}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <div className="shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "Uploading…" : "Upload doc"}
          </Button>
        </div>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full transition-all ${barColor}`}
            style={{ width: `${pctUsed}%` }}
          />
        </div>
        <span className={`shrink-0 text-xs ${textColor}`}>
          {formatChars(totalChars)} / {formatChars(CONTEXT_DOCS_TOTAL_BUDGET_CHARS)} ({pctUsed}%)
        </span>
      </div>

      {(uploadError || warningMessage) && (
        <p className={`mt-1 text-xs ${uploadError ? "text-red-500" : textColor}`}>
          {uploadError ?? warningMessage}
        </p>
      )}
    </div>
  );
}
