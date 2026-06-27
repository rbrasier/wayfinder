"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { SESSION_UPLOADS_ALLOWED_MIME_TYPES } from "@rbrasier/shared";

interface ChatComposerProps {
  sessionId: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}

interface SessionUploadSummary {
  id: string;
  filename: string;
}

const ACCEPT_ATTRIBUTE = SESSION_UPLOADS_ALLOWED_MIME_TYPES.join(",");

export function ChatComposer({
  sessionId,
  value,
  onChange,
  onSubmit,
  disabled = false,
  readOnly = false,
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<SessionUploadSummary[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  const refreshUploads = useCallback(async () => {
    const response = await fetch(`/api/chat/${sessionId}/uploads`);
    if (!response.ok) return;
    const data = (await response.json()) as SessionUploadSummary[];
    setUploads(data);
  }, [sessionId]);

  useEffect(() => {
    if (readOnly) return;
    void refreshUploads();
  }, [readOnly, refreshUploads]);

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/chat/${sessionId}/uploads`, {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Failed to upload file");
        return;
      }
      const upload = (await response.json()) as SessionUploadSummary;
      setUploads((current) => [...current, { id: upload.id, filename: upload.filename }]);
      toast.success(`Added "${upload.filename}" as context`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = async (uploadId: string) => {
    const response = await fetch(`/api/chat/${sessionId}/uploads/${uploadId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      toast.error("Failed to remove file");
      return;
    }
    setUploads((current) => current.filter((upload) => upload.id !== uploadId));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  };

  if (readOnly) {
    return (
      <div className="shrink-0 border-t border-[#dedad2] bg-[#f7f6f3] px-5 py-3 text-center text-[13px] text-[#6d6a65]">
        This is a shared session — view only.
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-[#dedad2] bg-white px-4 py-3">
      {uploads.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-[6px]">
          {uploads.map((upload) => (
            <span
              key={upload.id}
              className="flex items-center gap-[6px] rounded-[7px] border border-[#dedad2] bg-[#f7f6f3] px-[8px] py-[4px] text-[12px] text-[#1a1814]"
            >
              <Paperclip className="h-3 w-3 text-[#6d6a65]" />
              <span className="max-w-[180px] truncate">{upload.filename}</span>
              <button
                type="button"
                aria-label={`Remove ${upload.filename}`}
                onClick={() => handleRemove(upload.id)}
                disabled={disabled}
                className="text-[#6d6a65] hover:text-[#1a1814] disabled:cursor-not-allowed"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-[10px]">
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleFileSelected}
          className="hidden"
        />
        <button
          type="button"
          aria-label="Attach a file for context"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || isUploading}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border-[1.5px] border-[#dedad2] bg-[#f7f6f3] text-[#56514b] hover:border-[#c5d0f7] hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Paperclip className="h-4 w-4" />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Message Wayfinder…"
          className="flex-1 resize-none rounded-[9px] border-[1.5px] border-[#dedad2] bg-[#f7f6f3] px-[14px] py-[10px] text-[13px] leading-[1.45] text-[#1a1814] outline-none placeholder:text-[#6d6a65] focus:border-[#c5d0f7] focus:bg-white disabled:cursor-not-allowed"
          style={{ minHeight: "40px", maxHeight: "120px", overflowY: "auto" }}
        />
        <button
          type="button"
          aria-label="Send message"
          onClick={onSubmit}
          disabled={!value.trim() || disabled}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#3a5fd9] text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-[6px] text-center text-[11px] text-[#6d6a65]">
        {isUploading
          ? "Uploading file…"
          : "Wayfinder works agentically — it asks follow-up questions and signals when each step is complete."}
      </p>
    </div>
  );
}
