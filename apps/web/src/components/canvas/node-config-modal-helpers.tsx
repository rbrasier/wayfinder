"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { FieldValueSource } from "@rbrasier/domain";
import type { NodeConfigValues } from "./node-config-modal";

export const COLOURS = [
  { hex: "#3a5fd9", label: "Indigo" },
  { hex: "#2e9e6a", label: "Green" },
  { hex: "#c17a1a", label: "Amber" },
  { hex: "#c2385a", label: "Rose" },
  { hex: "#7c3aed", label: "Purple" },
  { hex: "#0e8a7a", label: "Teal" },
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
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied!" : "Copy"}
    </button>
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
