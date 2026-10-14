"use client";

import { X } from "lucide-react";
import type { SkippedUpload } from "@rbrasier/domain";

// Lists the files the last upload left out and why, so missing evidence is never
// mistaken for an extraction fault. Shown until dismissed or the next upload.
export function SkippedUploadsNotice({
  skipped,
  onDismiss,
}: {
  skipped: SkippedUpload[];
  onDismiss: () => void;
}) {
  if (skipped.length === 0) return null;

  return (
    <div
      role="status"
      className="mt-2 rounded-[9px] border border-[#f0dcb4] bg-[#fbf4e6] px-3 py-2 text-[12px] text-[#7a5a17]"
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 font-medium">
          {skipped.length === 1 ? "1 file was not added" : `${skipped.length} files were not added`}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss skipped files"
          className="text-[#7a5a17] hover:text-[#3d382f]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="mt-1 space-y-0.5">
        {skipped.map((file) => (
          <li key={file.treePath} className="wrap-break-word">
            <span className="font-mono">{file.treePath}</span> — {file.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
