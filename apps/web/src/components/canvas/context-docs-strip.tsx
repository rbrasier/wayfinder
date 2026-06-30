"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import type { FlowContextDoc } from "@rbrasier/domain";
import {
  CONTEXT_DOCS_ALLOWED_MIME_TYPES,
  CONTEXT_DOCS_MAX_FILE_SIZE_BYTES,
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

        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" asChild>
            <Link href={`/knowledge?flowId=${flowId}`}>
              <BookOpen size={14} />
              View knowledge
            </Link>
          </Button>
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

      {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
    </div>
  );
}
