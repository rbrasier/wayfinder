"use client";

import type { JsonTreeRow } from "./watch-model";

const KIND_HINT: Record<JsonTreeRow["kind"], string> = {
  object: "{ }",
  array: "[ ]",
  value: "",
  more: "",
};

// The sample response as a read-only tree, so an admin can see what the
// dropdowns are offering and how the response is shaped (ADR-063 §2).
export function JsonSamplePreview({ rows }: { rows: JsonTreeRow[] }) {
  return (
    <ul className="max-h-[360px] overflow-auto rounded-[9px] border border-[#e7e3db] bg-white py-1 font-mono text-[12px]">
      {rows.map((row, index) => (
        <li
          key={`${row.path}-${index}`}
          style={{ paddingLeft: 8 + row.depth * 14 }}
          className="flex items-center gap-2 px-1.5 py-0.5"
        >
          <span className={row.kind === "more" ? "text-[#9a9384]" : "text-[#1c1b19]"}>{row.label}</span>
          {KIND_HINT[row.kind] && <span className="text-[#9a9384]">{KIND_HINT[row.kind]}</span>}
          {row.preview && <span className="truncate text-[#736d5f]">{row.preview}</span>}
        </li>
      ))}
    </ul>
  );
}
