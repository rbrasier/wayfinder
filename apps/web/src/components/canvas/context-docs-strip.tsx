"use client";

import { BookOpen, Plug } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import type { FlowContextDoc } from "@rbrasier/domain";
import {
  CONTEXT_DOCS_ALLOWED_MIME_TYPES,
  CONTEXT_DOCS_MAX_FILE_SIZE_BYTES,
} from "@rbrasier/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  // Flow-wide context MCP (ADR-032). Hidden entirely unless the author holds the
  // `mcp` feature flag.
  mcpEnabled?: boolean;
  contextMcpServerIds?: string[];
  onContextMcpServerIdsChange?: (ids: string[]) => void;
}

export function ContextDocsStrip({
  flowId,
  docs,
  onDocsChange,
  mcpEnabled = false,
  contextMcpServerIds = [],
  onContextMcpServerIdsChange,
}: ContextDocsStripProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [mcpPickerOpen, setMcpPickerOpen] = useState(false);

  const removeMutation = trpc.flow.contextDoc.remove.useMutation({
    onSuccess: (_, variables) => {
      onDocsChange(docs.filter((d) => d.id !== variables.docId));
    },
  });

  const serversQuery = trpc.mcpServer.listWithTools.useQuery(undefined, { enabled: mcpEnabled });
  const contextServers = (serversQuery.data ?? []).filter(
    (entry) => entry.server.kind === "context",
  );
  const serverLabelById = new Map(contextServers.map((entry) => [entry.server.id, entry.server.label]));
  const setServersMutation = trpc.flow.contextMcp.setServers.useMutation();

  const setContextServers = (ids: string[]) => {
    onContextMcpServerIdsChange?.(ids);
    setServersMutation.mutate({ flowId, serverIds: ids });
  };
  const toggleContextServer = (serverId: string) => {
    const next = contextMcpServerIds.includes(serverId)
      ? contextMcpServerIds.filter((id) => id !== serverId)
      : [...contextMcpServerIds, serverId];
    setContextServers(next);
  };

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

          {mcpEnabled &&
            contextMcpServerIds.map((serverId) => (
              <div
                key={serverId}
                className="flex shrink-0 items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5"
              >
                <span className="flex items-center gap-1 rounded bg-teal-100 px-1.5 py-0.5 text-xs font-medium text-teal-700">
                  <Plug size={11} />
                  MCP
                </span>
                <span className="max-w-[160px] truncate text-xs text-gray-700">
                  {serverLabelById.get(serverId) ?? "MCP server"}
                </span>
                <button
                  type="button"
                  className="text-gray-400 hover:text-red-500"
                  onClick={() => toggleContextServer(serverId)}
                  disabled={setServersMutation.isPending}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
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
          {mcpEnabled && (
            <Button size="sm" variant="outline" onClick={() => setMcpPickerOpen(true)}>
              <Plug size={14} />
              Add MCP
            </Button>
          )}
        </div>
      </div>

      {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}

      {mcpEnabled && (
        <Dialog open={mcpPickerOpen} onOpenChange={(open) => !open && setMcpPickerOpen(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add context MCP servers</DialogTitle>
              <DialogCloseButton />
            </DialogHeader>
            <DialogBody className="space-y-3">
              <p className="text-[12px] text-[#857f76]">
                Read-only servers whose tools ground the whole flow. Register servers on the MCP
                Servers page and set their type to Context.
              </p>
              {contextServers.length === 0 ? (
                <p className="text-[13px] text-[#857f76]">No context MCP servers available.</p>
              ) : (
                <div className="space-y-1.5 rounded-[9px] border border-[#dedad2] p-2.5">
                  {contextServers.map((entry) => (
                    <label
                      key={entry.server.id}
                      className="flex cursor-pointer items-start gap-2 text-[13px]"
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        aria-label={entry.server.label}
                        checked={contextMcpServerIds.includes(entry.server.id)}
                        onChange={() => toggleContextServer(entry.server.id)}
                      />
                      <span className="font-medium">{entry.server.label}</span>
                      <span className="text-[#857f76]">— {entry.tools.length} tool(s)</span>
                    </label>
                  ))}
                </div>
              )}
            </DialogBody>
            <DialogFooter>
              <Button type="button" onClick={() => setMcpPickerOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
