"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { FieldValueSource } from "@wayfinder/domain";
import type { NodeConfigValues } from "./node-config-modal";

export const COLOURS = [
  { hex: "#2f56d3", label: "Indigo" },
  { hex: "#1f6b4d", label: "Green" },
  { hex: "#8a5a1d", label: "Amber" },
  { hex: "#a8324c", label: "Rose" },
  { hex: "#5b3fa8", label: "Purple" },
  { hex: "#14312e", label: "Teal" },
];

// Field keys that are low-level HTTP concerns and should be hidden from the
// primary "Add request fields" list behind a collapsed "Advanced fields" section.
// Keys are normalised (lowercase, alphanumeric only) to match TemplateField.key.
const ADVANCED_REQUEST_FIELD_KEYS = new Set(["headers", "params", "query", "webhookurl", "executionmode"]);

// Returns true for exact matches (e.g. "headers") and for nested subfields
// produced by the recursive extractor (e.g. "headers.content-type").
export function isAdvancedField(key: string): boolean {
  if (ADVANCED_REQUEST_FIELD_KEYS.has(key)) return true;
  return [...ADVANCED_REQUEST_FIELD_KEYS].some((prefix) => key.startsWith(`${prefix}.`));
}

// An author-added request field while it is being edited. The key is derived
// from the label on save; the id keeps React rows stable as the label changes.
export interface CustomRequestField {
  id: string;
  label: string;
  value: FieldValueSource;
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#1c1b19]"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// A single coloured circle that sits at the end of the step-name row. Clicking
// it opens an inline overlay of the available colours; picking one sets it and
// closes the menu. Replaces the old always-visible swatch row.
export function StepColourPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (hex: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const current = COLOURS.find((colour) => colour.hex === value);

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Step colour${current ? `: ${current.label}` : ""} — click to change`}
        onClick={() => setOpen((prev) => !prev)}
        className="h-6 w-6 rounded-full ring-1 ring-inset ring-[rgba(0,0,0,0.12)] transition-transform hover:scale-110"
        style={{ background: value }}
      />
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1.5 flex gap-1.5 rounded-[10px] border border-[#e7e3db] bg-white p-2 shadow-[0_4px_16px_rgba(0,0,0,.12)]">
          {COLOURS.map((colour) => (
            <button
              key={colour.hex}
              type="button"
              title={colour.label}
              aria-label={colour.label}
              onClick={() => {
                onChange(colour.hex);
                setOpen(false);
              }}
              className={`h-5 w-5 rounded-full transition-transform hover:scale-110 ${
                value === colour.hex ? "ring-2 ring-[#1c1b19] ring-offset-1" : ""
              }`}
              style={{ background: colour.hex }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const buildCustomFields = (values: Partial<NodeConfigValues>): CustomRequestField[] => {
  const customKeys = new Set(values.customRequestFieldKeys ?? []);
  return (values.requestFields ?? [])
    .filter((field) => customKeys.has(field.key))
    .map((field) => ({
      id: field.key,
      label: field.label,
      value: values.requestFieldValues?.[field.key] ?? { kind: "ai" },
    }));
};
