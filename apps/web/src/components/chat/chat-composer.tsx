"use client";

import { useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  readOnly?: boolean;
}

export function ChatComposer({ value, onChange, onSubmit, disabled = false, readOnly = false }: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !disabled) onSubmit();
    }
  };

  if (readOnly) {
    return (
      <div className="border-t bg-gray-50 p-4 text-center text-sm text-muted-foreground">
        This is a shared session — view only.
      </div>
    );
  }

  return (
    <div className="border-t bg-white p-4">
      <div className="flex items-end gap-2 rounded-xl border bg-gray-50 px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:ring-offset-1">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Message Wayfinder…"
          className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-gray-400 disabled:cursor-not-allowed"
          style={{ maxHeight: "120px", overflowY: "auto" }}
        />
        <Button
          type="button"
          size="sm"
          aria-label="Send message"
          onClick={onSubmit}
          disabled={!value.trim() || disabled}
          className="shrink-0 rounded-lg"
        >
          ↑
        </Button>
      </div>
      <p className="mt-1.5 text-center text-xs text-muted-foreground">
        Wayfinder works agentically — it asks follow-up questions and signals when each step is complete.
      </p>
    </div>
  );
}
