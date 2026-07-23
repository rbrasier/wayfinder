"use client";

import { useMemo, useState } from "react";
import { Info, Pencil } from "lucide-react";
import {
  aggregateConfidence,
  confidenceBand,
  recordConfidenceBand,
  type ConfidenceBand,
} from "@rbrasier/domain";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface ResultDocument {
  id: string;
  filename: string;
  treePath: string;
  readable: boolean;
}

export interface ResultFieldValue {
  key: string;
  value: string;
  confidence: number;
  rationale: string;
}

export interface ResultRecord {
  id: string;
  label: string;
  fields: ResultFieldValue[];
  sourceDocumentIds: string[];
}

export interface SampleResult {
  documents: ResultDocument[];
  records: ResultRecord[];
  exceptionFileIds: string[];
}

// Optional run-viewer affordances (phase §4). Absent for the read-only authoring
// sample; supplied by the run screen to enable source download, audited editing,
// and the exceptions filter over the same grid.
export interface ResultGridOptions {
  // Turns a source file into a download link (compare input against output).
  documentHref?: (documentId: string) => string;
  // Audited per-field correction. When supplied, each value cell gains an edit
  // affordance; the callback performs the mutation and refresh.
  onEditField?: (recordId: string, fieldKey: string, newValue: string) => void;
  editing?: boolean;
  showFilters?: boolean;
}

const BAND_DOT: Record<ConfidenceBand, string> = {
  red: "bg-[#d1493f]",
  amber: "bg-[#d99a2b]",
  green: "bg-[#2f9e6b]",
};

const BAND_LABEL: Record<ConfidenceBand, string> = {
  red: "Low confidence",
  amber: "Medium confidence",
  green: "High confidence",
};

function ConfidenceDot({ confidence, onInfo }: { confidence: number; onInfo: () => void }) {
  const band = confidenceBand(confidence);
  return (
    <span className="inline-flex items-center gap-[4px]">
      <span
        className={`inline-block h-[10px] w-[10px] rounded-full ${BAND_DOT[band]}`}
        aria-label={BAND_LABEL[band]}
      />
      <button
        type="button"
        onClick={onInfo}
        aria-label="Show confidence rationale"
        className="text-[#8a857c] hover:text-[#3a352e]"
      >
        <Info className="h-[13px] w-[13px]" />
      </button>
    </span>
  );
}

export function ResultGrid({
  result,
  options = {},
}: {
  result: SampleResult;
  options?: ResultGridOptions;
}) {
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(
    result.records[0]?.id ?? null,
  );
  const [rationale, setRationale] = useState<ResultFieldValue | null>(null);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [editTarget, setEditTarget] = useState<{ record: ResultRecord; field: ResultFieldValue } | null>(
    null,
  );
  const [draftValue, setDraftValue] = useState("");

  const selectedRecord = result.records.find((record) => record.id === selectedRecordId) ?? null;
  const highlightedDocIds = new Set(selectedRecord?.sourceDocumentIds ?? []);
  const exceptionRecordIds = useMemo(() => exceptionRecords(result), [result]);

  const visibleRecords = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return result.records.filter((record) => {
      if (exceptionsOnly && !exceptionRecordIds.has(record.id)) return false;
      if (needle.length === 0) return true;
      return (
        record.label.toLowerCase().includes(needle) ||
        record.fields.some((field) => field.value.toLowerCase().includes(needle))
      );
    });
  }, [result.records, exceptionsOnly, exceptionRecordIds, query]);

  const openEdit = (record: ResultRecord, field: ResultFieldValue) => {
    setEditTarget({ record, field });
    setDraftValue(field.value);
  };

  const submitEdit = () => {
    if (editTarget && options.onEditField) {
      options.onEditField(editTarget.record.id, editTarget.field.key, draftValue);
    }
    setEditTarget(null);
  };

  return (
    <div className="flex flex-col gap-[12px]">
      {options.showFilters ? (
        <div className="flex flex-wrap items-center gap-[10px]">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter records…"
            className="max-w-[240px]"
            aria-label="Filter records"
          />
          <label className="flex items-center gap-[6px] text-[13px] text-[#5a5650]">
            <input
              type="checkbox"
              checked={exceptionsOnly}
              onChange={(event) => setExceptionsOnly(event.target.checked)}
            />
            Exceptions only
          </label>
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_3fr] gap-[16px]">
        {/* Included files (left, ~¼ width) */}
        <div className="rounded-[10px] border border-[#e5e1d8] bg-white p-[12px]">
          <h3 className="mb-[8px] text-[12px] font-semibold uppercase tracking-[0.05em] text-[#6d6a65]">
            Included files
          </h3>
          <ul className="flex flex-col gap-[4px]">
            {result.documents.map((document) => {
              const highlighted = highlightedDocIds.has(document.id);
              const isException = result.exceptionFileIds.includes(document.id);
              return (
                <li
                  key={document.id}
                  className={`rounded-[7px] px-[8px] py-[6px] text-[13px] ${
                    highlighted ? "bg-[#eef1fc] text-[#3a5fd9]" : "text-[#5a5650]"
                  }`}
                >
                  {options.documentHref ? (
                    <a
                      href={options.documentHref(document.id)}
                      className="block truncate font-medium hover:underline"
                    >
                      {document.filename}
                    </a>
                  ) : (
                    <span className="block truncate font-medium">{document.filename}</span>
                  )}
                  <span className="block truncate text-[11px] text-[#8a857c]">{document.treePath}</span>
                  {!document.readable && (
                    <span className="mt-[2px] inline-block rounded-[4px] bg-[#fbecea] px-[5px] py-[1px] text-[10px] font-semibold text-[#b23b30]">
                      Unreadable
                    </span>
                  )}
                  {isException && (
                    <span className="mt-[2px] inline-block rounded-[4px] bg-[#fdf3e3] px-[5px] py-[1px] text-[10px] font-semibold text-[#9b6215]">
                      No record
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Output records (right) */}
        <div className="overflow-x-auto rounded-[10px] border border-[#e5e1d8] bg-white">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[#e5e1d8] text-left text-[11px] uppercase tracking-[0.05em] text-[#6d6a65]">
                <th scope="col" className="px-[12px] py-[8px]">Record</th>
                <th scope="col" className="px-[12px] py-[8px]">Field</th>
                <th scope="col" className="px-[12px] py-[8px]">Value</th>
                <th scope="col" className="px-[12px] py-[8px]">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((record) => {
                const band = recordConfidenceBand(record);
                return record.fields.map((field, fieldIndex) => (
                  <tr
                    key={`${record.id}-${field.key}`}
                    onClick={() => setSelectedRecordId(record.id)}
                    className={`cursor-pointer border-b border-[#f0ede7] ${
                      selectedRecordId === record.id ? "bg-[#f7f9ff]" : "hover:bg-[#faf9f6]"
                    }`}
                  >
                    {fieldIndex === 0 ? (
                      <td
                        rowSpan={record.fields.length}
                        className="align-top px-[12px] py-[8px] font-medium text-[#3a352e]"
                      >
                        <span className="flex items-center gap-[6px]">
                          <span
                            className={`inline-block h-[10px] w-[10px] rounded-full ${BAND_DOT[band]}`}
                            aria-label={`Record ${BAND_LABEL[band].toLowerCase()}`}
                          />
                          {record.label}
                        </span>
                        <span className="mt-[2px] block text-[11px] font-normal text-[#8a857c]">
                          {Math.round(aggregateConfidence(record) * 100)}% overall
                        </span>
                      </td>
                    ) : null}
                    <td className="px-[12px] py-[8px] text-[#5a5650]">{field.key}</td>
                    <td className="px-[12px] py-[8px] text-[#3a352e]">
                      <span className="inline-flex items-center gap-[6px]">
                        {field.value || <span className="text-[#b6b1a8]">—</span>}
                        {options.editing ? (
                          <button
                            type="button"
                            aria-label={`Edit ${field.key}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openEdit(record, field);
                            }}
                            className="text-[#8a857c] hover:text-[#3a352e]"
                          >
                            <Pencil className="h-[12px] w-[12px]" />
                          </button>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-[12px] py-[8px]">
                      <ConfidenceDot confidence={field.confidence} onInfo={() => setRationale(field)} />
                    </td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={rationale !== null} onOpenChange={(open) => !open && setRationale(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confidence rationale</DialogTitle>
          </DialogHeader>
          {rationale && (
            <div className="flex flex-col gap-[8px] text-[13px]">
              <p>
                <span className="font-semibold">{BAND_LABEL[confidenceBand(rationale.confidence)]}</span>{" "}
                ({Math.round(rationale.confidence * 100)}%)
              </p>
              <p className="text-[#5a5650]">{rationale.rationale || "No rationale provided."}</p>
              <p className="text-[11px] text-[#8a857c]">
                Confidence is a self-assessed triage signal, not a guarantee — always verify amber and
                red values.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editTarget?.field.key}</DialogTitle>
          </DialogHeader>
          <Input
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            aria-label="Corrected value"
          />
          <p className="text-[11px] text-[#8a857c]">
            Your correction is recorded in the audit trail. The AI is not re-run.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={submitEdit}>
              Save correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// A record is an exception when it drew on an exception file, or when every one
// of its fields is empty (nothing was pulled) — the triage the operator filters to.
const exceptionRecords = (result: SampleResult): Set<string> => {
  const exceptionFiles = new Set(result.exceptionFileIds);
  const ids = new Set<string>();
  for (const record of result.records) {
    const drewOnException = record.sourceDocumentIds.some((id) => exceptionFiles.has(id));
    const allBlank = record.fields.every((field) => field.value.trim().length === 0);
    if (drewOnException || allBlank) ids.add(record.id);
  }
  return ids;
};
