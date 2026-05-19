"use client";

import { useRef, useState } from "react";
import type { FlowContextDoc } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";

const FILE_TYPE_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface ContextDocsStripProps {
  flowId: string;
  docs: FlowContextDoc[];
  onDocsChange: (docs: FlowContextDoc[]) => void;
}

export function ContextDocsStrip({ flowId, docs, onDocsChange }: ContextDocsStripProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const removeMutation = trpc.flow.contextDoc.remove.useMutation({
    onSuccess: (_, variables) => {
      onDocsChange(docs.filter((d) => d.id !== variables.docId));
    },
  });

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 20 * 1024 * 1024) {
      setUploadError("File exceeds 20 MB limit.");
      return;
    }

    const allowed = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (!allowed.includes(file.type)) {
      setUploadError("Only PDF, DOCX, and XLSX files are accepted.");
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
        const data = await response.json() as { error?: string };
        setUploadError(data.error ?? "Upload failed.");
        return;
      }

      const doc = await response.json() as FlowContextDoc;
      onDocsChange([...docs, doc]);
    } catch {
      setUploadError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="border-t bg-white px-4 py-3">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium text-gray-700 shrink-0">Context docs</span>

        <div className="flex flex-1 items-center gap-2 overflow-x-auto">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="flex shrink-0 items-center gap-2 rounded-md border bg-gray-50 px-3 py-1.5"
            >
              <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700">
                {FILE_TYPE_LABELS[doc.mimeType] ?? "FILE"}
              </span>
              <span className="max-w-[160px] truncate text-xs text-gray-700">{doc.filename}</span>
              <span className="text-xs text-gray-400">{formatBytes(doc.sizeBytes)}</span>
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
          ))}
        </div>

        <div className="shrink-0">
          {uploadError && <p className="mb-1 text-xs text-red-500">{uploadError}</p>}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx"
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
    </div>
  );
}
