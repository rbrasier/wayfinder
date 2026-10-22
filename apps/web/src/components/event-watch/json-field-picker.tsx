"use client";

import type { JsonTreeRow } from "./watch-model";

interface JsonFieldPickerProps {
  rows: JsonTreeRow[];
  // Which rows the field being picked can take (a list for the items path, a
  // value for the item ID, …).
  canPick: (row: JsonTreeRow) => boolean;
  onPick: (path: string) => void;
  selectedPath?: string;
}

const KIND_HINT: Record<JsonTreeRow["kind"], string> = {
  object: "{ }",
  array: "[ ]",
  value: "",
  more: "",
};

// The sample response as a tree to click paths from (ADR-063 §2). Rows that
// cannot fill the field being picked are shown but not clickable.
export function JsonFieldPicker({ rows, canPick, onPick, selectedPath }: JsonFieldPickerProps) {
  return (
    <ul className="max-h-[360px] overflow-auto rounded-[9px] border border-[#e7e3db] bg-white py-1 font-mono text-[12px]">
      {rows.map((row, index) => {
        const pickable = row.kind !== "more" && canPick(row);
        const selected = pickable && row.path === selectedPath;
        const content = (
          <>
            <span className="text-[#1c1b19]">{row.label}</span>
            {KIND_HINT[row.kind] && <span className="text-[#9a9384]">{KIND_HINT[row.kind]}</span>}
            {row.preview && <span className="truncate text-[#736d5f]">{row.preview}</span>}
          </>
        );
        return (
          <li key={`${row.path}-${index}`} style={{ paddingLeft: 8 + row.depth * 14 }}>
            {pickable ? (
              <button
                type="button"
                onClick={() => onPick(row.path)}
                aria-pressed={selected}
                className={`flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-wf-primary-light ${
                  selected ? "bg-wf-primary-light text-wf-primary" : ""
                }`}
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-2 px-1.5 py-0.5 opacity-60">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
