"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { SESSION_UPLOADS_ALLOWED_MIME_TYPES } from "@rbrasier/shared";
import { resolveChatDisclaimerComposerText } from "@rbrasier/domain";
import { trpc } from "@/trpc/client";

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

  // This component re-renders on every keystroke, so the disclaimer is read with
  // a long stale time and no refetch on focus — it changes only when an admin
  // edits it, and must not sit on the typing path.
  const disclaimerQuery = trpc.settings.getChatDisclaimer.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const disclaimerText = disclaimerQuery.data
    ? resolveChatDisclaimerComposerText(disclaimerQuery.data)
    : null;

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
      <div className="shrink-0 border-t border-[#e7e3db] bg-[#faf9f7] px-5 py-3 text-center text-[13px] text-[#666055]">
        This is a shared session — view only.
      </div>
    );
  }

  return (
    <div className="shrink-0 px-4 pb-[18px] pt-[14px] sm:px-6">
      <div className="mx-auto flex max-w-[760px] flex-col gap-[8px]">
        {uploads.length > 0 && (
          <div className="flex flex-wrap gap-[6px]">
            {uploads.map((upload) => (
              <span
                key={upload.id}
                className="flex items-center gap-[6px] rounded-[7px] border border-[#e7e3db] bg-white px-[8px] py-[4px] text-[12px] text-[#1c1b19]"
              >
                <Paperclip className="h-3 w-3 text-[#666055]" />
                <span className="max-w-[180px] truncate">{upload.filename}</span>
                <button
                  type="button"
                  aria-label={`Remove ${upload.filename}`}
                  onClick={() => handleRemove(upload.id)}
                  disabled={disabled}
                  className="text-[#666055] hover:text-[#1c1b19] disabled:cursor-not-allowed"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-[10px] rounded-[14px] border border-[#dedad2] bg-white px-[12px] py-[10px] shadow-[0_6px_18px_-14px_rgba(28,27,25,0.4)] focus-within:border-[#c3cef2]">
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
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#1c1b19] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Paperclip className="h-[17px] w-[17px]" />
          </button>
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Message Wayfinder…"
            className="flex-1 resize-none border-none bg-transparent py-[5px] text-[14px] leading-[1.45] text-[#1c1b19] outline-none placeholder:text-[#736d5f] disabled:cursor-not-allowed"
            style={{ minHeight: "30px", maxHeight: "120px", overflowY: "auto" }}
          />
          <button
            type="button"
            aria-label="Send message"
            onClick={onSubmit}
            disabled={!value.trim() || disabled}
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-[#2f56d3] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUp className="h-[15px] w-[15px]" />
          </button>
        </div>

        {(isUploading || disclaimerText) && (
          <p className="text-center text-[10.5px] text-[#736d5f]" data-testid="chat-disclaimer-line">
            {isUploading ? "Uploading file…" : disclaimerText}
          </p>
        )}
      </div>
    </div>
  );
}
