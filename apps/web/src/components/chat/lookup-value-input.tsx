"use client";

import { useState } from "react";
import { formatValueSetEntry, type ValueSetEntry } from "@rbrasier/domain";
import { Input } from "@/components/ui/input";
import { trpc } from "@/trpc/client";

const SELECT_CLASS =
  "flex h-9 w-full rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-1.5 text-[13px] text-[#1c1b19] focus:border-[#2f56d3] focus:bg-white focus:outline-none";

export const splitSelection = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

// A single-value field replaces its value; a multi-select appends, ignoring a
// repeat pick so the same department cannot be chosen twice.
export const applySelection = (
  currentValue: string,
  display: string,
  multiple: boolean,
): string => {
  if (!multiple) return display;

  const selected = splitSelection(currentValue);
  if (selected.some((entry) => entry.toLowerCase() === display.toLowerCase())) return currentValue;
  return [...selected, display].join(", ");
};

export const removeSelection = (currentValue: string, display: string): string =>
  splitSelection(currentValue)
    .filter((entry) => entry.toLowerCase() !== display.toLowerCase())
    .join(", ");

interface LookupValueInputProps {
  fieldKey: string;
  sourceName: string;
  multiple: boolean;
  value: string;
  onChange: (value: string) => void;
}

// The picker for a field bound to a lookup source whose set is too large to
// inline. Results come from the live source, and every option shows its key so
// two identically-labelled entries can be told apart (ADR-050 §3, §4).
export function LookupValueInput({
  fieldKey,
  sourceName,
  multiple,
  value,
  onChange,
}: LookupValueInputProps) {
  const [term, setTerm] = useState("");
  const results = trpc.lookupSource.search.useQuery(
    { sourceName, query: term, limit: 20 },
    { enabled: term.trim().length > 0 },
  );

  const selected = multiple ? splitSelection(value) : [];
  const entries: ValueSetEntry[] = results.data ?? [];

  return (
    <div className="space-y-1.5">
      {multiple && selected.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {selected.map((entry) => (
            <li key={entry}>
              <button
                type="button"
                className="rounded-full border border-[#e7e3db] px-2 py-0.5 text-[12px]"
                onClick={() => onChange(removeSelection(value, entry))}
              >
                {entry} ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!multiple && value ? (
        <p className="text-[13px] text-[#1c1b19]">
          Selected: <span className="font-medium">{value}</span>
        </p>
      ) : null}

      <Input
        id={`field-${fieldKey}`}
        type="text"
        value={term}
        placeholder={`Search ${sourceName}…`}
        onChange={(event) => setTerm(event.target.value)}
      />

      {results.isFetching ? <p className="text-[12px] text-[#6b675f]">Searching…</p> : null}

      {term.trim().length > 0 && !results.isFetching && entries.length === 0 ? (
        <p className="text-[12px] text-[#6b675f]">No matches in {sourceName}.</p>
      ) : null}

      {entries.length > 0 ? (
        <ul className={`${SELECT_CLASS} h-auto max-h-40 flex-col overflow-y-auto p-1`}>
          {entries.map((entry) => (
            <li key={`${entry.display}-${entry.key ?? ""}`}>
              <button
                type="button"
                className="w-full rounded px-2 py-1 text-left text-[13px] hover:bg-[#f0eee9]"
                onClick={() => {
                  onChange(applySelection(value, entry.display, multiple));
                  setTerm("");
                }}
              >
                {formatValueSetEntry(entry)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
