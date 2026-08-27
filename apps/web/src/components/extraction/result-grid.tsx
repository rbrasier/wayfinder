"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Download, Pencil } from "lucide-react";
import { confidenceBand, type ConfidenceBand } from "@rbrasier/domain";
import { aggregateConfidenceSummaries } from "./field-provenance-display";
import { FieldRationale, ProvenanceTag } from "./field-provenance-detail";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  exceptionRecordIds,
  fieldColumnKeys,
  fieldValue,
  pairFields,
  pendingDocuments,
  recordExceptionReasons,
  toggleExpanded,
  visibleRecords,
} from "./result-grid-model";
import type {
  ResultDocument,
  ResultFieldValue,
  ResultRecord,
  SampleResult,
} from "./result-grid-model";

export type { ResultDocument, ResultFieldValue, ResultRecord, SampleResult };

// Optional run-viewer affordances (phase §4). Absent for the read-only authoring
// sample; supplied by the run screen to enable source download, audited editing,
// and the exceptions filter over the same grid.
export interface ResultGridOptions {
  // Turns a source file into a download link (compare input against output).
  documentHref?: (documentId: string) => string;
  // Audited per-field correction. When supplied, each value in the expanded
  // detail gains an edit affordance; the callback performs the mutation and refresh.
  onEditField?: (recordId: string, fieldKey: string, newValue: string) => void;
  editing?: boolean;
  showFilters?: boolean;
}

const BAND_DOT: Record<ConfidenceBand, string> = {
  red: "bg-[#d1493f]",
  amber: "bg-[#d99a2b]",
  green: "bg-[#2f9e6b]",
};

const BAND_RING: Record<ConfidenceBand, string> = {
  red: "ring-[#f0c4c0]",
  amber: "ring-[#f0dcb4]",
  green: "ring-[#bfe3d2]",
};

const BAND_LABEL: Record<ConfidenceBand, string> = {
  red: "Low confidence",
  amber: "Medium confidence",
  green: "High confidence",
};

// The RAG dot is the control, not decoration beside one — a single target that
// both reports the band and opens the rationale behind it.
function ConfidenceDot({
  field,
  recordLabel,
  onInfo,
}: {
  field: ResultFieldValue;
  recordLabel: string;
  onInfo: () => void;
}) {
  const band = confidenceBand(field.confidence);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onInfo();
      }}
      aria-label={`${field.key} — ${BAND_LABEL[band].toLowerCase()} on ${recordLabel}. Show rationale`}
      title={`${BAND_LABEL[band]} (${Math.round(field.confidence * 100)}%)`}
      className={`inline-block h-[9px] w-[9px] shrink-0 rounded-full ring-2 transition-transform hover:scale-125 ${BAND_DOT[band]} ${BAND_RING[band]}`}
    />
  );
}

function ValueCell({
  record,
  field,
  onInfo,
}: {
  record: ResultRecord;
  field: ResultFieldValue | null;
  onInfo: (field: ResultFieldValue) => void;
}) {
  if (!field) {
    return (
      <div className="flex min-w-0 items-start justify-between gap-[8px]">
        <span className="min-w-0 text-[#c9c3b5]">—</span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-start justify-between gap-[8px]">
      <span className="line-clamp-3 min-w-0 break-words" title={field.value || undefined}>
        {field.value || <span className="text-[#c9c3b5]">—</span>}
      </span>
      <span className="mt-[4px]">
        <ConfidenceDot field={field} recordLabel={record.label} onInfo={() => onInfo(field)} />
      </span>
    </div>
  );
}

export function ResultGrid({
  result,
  options = {},
}: {
  result: SampleResult;
  options?: ResultGridOptions;
}) {
  const [rationale, setRationale] = useState<ResultFieldValue | null>(null);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = useState<{ record: ResultRecord; field: ResultFieldValue } | null>(
    null,
  );
  const [draftValue, setDraftValue] = useState("");

  const exceptions = useMemo(() => exceptionRecordIds(result), [result]);
  const rows = useMemo(
    () => visibleRecords(result, { query, exceptionsOnly }),
    [result, query, exceptionsOnly],
  );
  const awaiting = useMemo(
    () => pendingDocuments(result, { query, exceptionsOnly }),
    [result, query, exceptionsOnly],
  );
  const columnKeys = useMemo(() => fieldColumnKeys(result.records), [result.records]);
  const documentsById = useMemo(
    () => new Map(result.documents.map((document) => [document.id, document])),
    [result.documents],
  );

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

  // Expand toggle + record label + one column per field.
  const columnCount = columnKeys.length + 2;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // The expanded detail panel pins to the visible viewport of this scroll
    // container so the top-level row can scroll horizontally without dragging
    // the detail off-screen with it.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewportWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
          <label className="flex items-center gap-[6px] text-[13px] text-[#5c574c]">
            <input
              type="checkbox"
              checked={exceptionsOnly}
              onChange={(event) => setExceptionsOnly(event.target.checked)}
            />
            Exceptions only
          </label>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="overflow-x-auto rounded-[10px] border border-[#e7e3db] bg-white"
      >
        <table
          className="w-full border-collapse text-[13px]"
          data-testid="results-table"
        >
          <thead>
            <tr className="border-b border-[#e7e3db] text-left text-[11px] uppercase tracking-[0.05em] text-[#666055]">
              <th scope="col" className="w-[36px] px-[8px] py-[8px]">
                <span className="sr-only">Expand</span>
              </th>
              <th scope="col" className="min-w-[220px] px-[12px] py-[8px]">
                <span className="block truncate">Record</span>
              </th>
              {columnKeys.map((key) => (
                <th
                  key={key}
                  scope="col"
                  className="min-w-[160px] max-w-[220px] px-[12px] py-[8px]"
                >
                  <span className="block truncate" title={key}>
                    {key}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((record) => {
              const isExpanded = expanded.has(record.id);
              const isException = exceptions.has(record.id);
              return (
                <ResultRow
                  key={record.id}
                  record={record}
                  columnKeys={columnKeys}
                  columnCount={columnCount}
                  detailPanelWidth={viewportWidth}
                  isExpanded={isExpanded}
                  isException={isException}
                  documentsById={documentsById}
                  exceptionFileIds={result.exceptionFileIds}
                  options={options}
                  onToggle={() => setExpanded((current) => toggleExpanded(current, record.id))}
                  onInfo={setRationale}
                  onEdit={openEdit}
                />
              );
            })}
            {awaiting.map((document) => (
              <PendingRow key={document.id} document={document} columnCount={columnCount} />
            ))}
            {rows.length === 0 && awaiting.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="px-[12px] py-[16px] text-[#736d5f]">
                  No records match the current filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Dialog open={rationale !== null} onOpenChange={(open) => !open && setRationale(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confidence rationale</DialogTitle>
          </DialogHeader>
          {rationale && (
            <DialogBody>
              <FieldRationale field={rationale} documents={result.documents} />
            </DialogBody>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editTarget?.field.key}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Input
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              aria-label="Corrected value"
            />
            <p className="text-[11px] text-[#736d5f]">
              Your correction is recorded in the audit trail. The AI is not re-run.
            </p>
          </DialogBody>
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

// A document the run has not reached yet. It has no values to show, so the row
// carries the filename and where it is in the queue — the operator can tell an
// outstanding document from one that produced nothing.
function PendingRow({ document, columnCount }: { document: ResultDocument; columnCount: number }) {
  const extracting = document.status === "extracting";
  return (
    <tr className="border-b border-[#e7e3db] bg-[#fbfaf7]" data-testid="pending-row">
      <td className="px-[8px] py-[6px] align-middle">
        <Spinner className="h-[13px] w-[13px] text-[#736d5f]" />
      </td>
      {/* The field columns are empty until this document is read, so the name
          spans them rather than trailing a row of em-dashes. */}
      <td colSpan={columnCount - 1} className="px-[12px] py-[6px] align-top text-[#666055]">
        <div className="flex min-w-0 items-start gap-[6px]">
          <span className="line-clamp-3 min-w-0 break-words" title={document.treePath}>
            {document.filename}
          </span>
          <span className="mt-[2px] inline-block shrink-0 rounded-[4px] bg-[#eaeefb] px-[5px] py-[1px] text-[10px] font-semibold text-[#2f56d3]">
            {extracting ? "Processing" : "Queued"}
          </span>
        </div>
      </td>
    </tr>
  );
}

interface ResultRowProps {
  record: ResultRecord;
  columnKeys: string[];
  columnCount: number;
  detailPanelWidth: number;
  isExpanded: boolean;
  isException: boolean;
  documentsById: Map<string, ResultDocument>;
  exceptionFileIds: string[];
  options: ResultGridOptions;
  onToggle: () => void;
  onInfo: (field: ResultFieldValue) => void;
  onEdit: (record: ResultRecord, field: ResultFieldValue) => void;
}

function ResultRow({
  record,
  columnKeys,
  columnCount,
  detailPanelWidth,
  isExpanded,
  isException,
  documentsById,
  exceptionFileIds,
  options,
  onToggle,
  onInfo,
  onEdit,
}: ResultRowProps) {
  return (
    <>
      <tr
        className={`border-b border-[#e7e3db] ${isExpanded ? "bg-[#f7f9ff]" : "hover:bg-[#faf9f6]"}`}
        data-testid="result-row"
      >
        <td className="px-[8px] py-[6px] align-middle">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${record.label}`}
            data-testid="expand-record"
            className="flex h-[20px] w-[20px] items-center justify-center rounded-[5px] border border-[#e7e3db] text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#1c1b19]"
          >
            {isExpanded ? <ChevronDown className="h-[13px] w-[13px]" /> : <ChevronRight className="h-[13px] w-[13px]" />}
          </button>
        </td>
        <td className="px-[12px] py-[6px] align-top font-medium text-[#3d382f]">
          <div className="flex min-w-0 items-start gap-[6px]">
            <span className="line-clamp-3 min-w-0 break-words" title={record.label}>
              {record.label}
            </span>
            {isException ? (
              <span className="mt-[2px] inline-block shrink-0 rounded-[4px] bg-[#f6e9d8] px-[5px] py-[1px] text-[10px] font-semibold text-[#8a5a1d]">
                Exception
              </span>
            ) : null}
          </div>
        </td>
        {columnKeys.map((key) => (
          <td key={key} className="px-[12px] py-[6px] align-top text-[#3d382f]">
            <ValueCell record={record} field={fieldValue(record, key)} onInfo={onInfo} />
          </td>
        ))}
      </tr>
      {isExpanded ? (
        <tr className="border-b border-[#e7e3db] bg-[#fbfaf7]" data-testid="result-row-detail">
          <td colSpan={columnCount} className="p-0">
            <div
              className="sticky left-0 w-full px-[16px] py-[14px]"
              style={detailPanelWidth > 0 ? { maxWidth: `${detailPanelWidth}px` } : undefined}
            >
              <RecordDetail
                record={record}
                documentsById={documentsById}
                exceptionFileIds={exceptionFileIds}
                options={options}
                onInfo={onInfo}
                onEdit={onEdit}
              />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function RecordDetail({
  record,
  documentsById,
  exceptionFileIds,
  options,
  onInfo,
  onEdit,
}: {
  record: ResultRecord;
  documentsById: Map<string, ResultDocument>;
  exceptionFileIds: string[];
  options: ResultGridOptions;
  onInfo: (field: ResultFieldValue) => void;
  onEdit: (record: ResultRecord, field: ResultFieldValue) => void;
}) {
  const sources = record.sourceDocumentIds
    .map((id) => documentsById.get(id))
    .filter((document): document is ResultDocument => document !== undefined);

  const exceptionReasons = recordExceptionReasons(record, {
    exceptionFileIds,
    documents: [...documentsById.values()],
  });

  return (
    <div className="flex flex-col gap-[14px]">
      <div className="flex flex-wrap items-baseline gap-x-[10px] gap-y-[2px]">
        <h4 className="text-[12px] font-semibold uppercase tracking-[0.05em] text-[#666055]">
          {record.label}
        </h4>
        {aggregateConfidenceSummaries(record).map((summary) => (
          <span key={summary.kind} className="text-[11px] text-[#736d5f]">
            {summary.text}
          </span>
        ))}
      </div>

      {exceptionReasons.length > 0 ? (
        <div
          data-testid="record-exception-detail"
          className="rounded-[8px] border border-[#f0d9ae] bg-[#fdf8ee] px-[12px] py-[10px]"
        >
          <h5 className="flex items-center gap-[6px] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#8a5a1d]">
            <AlertTriangle className="h-[12px] w-[12px] shrink-0" />
            Why this is an exception
          </h5>
          <ul className="mt-[6px] flex list-disc flex-col gap-[3px] pl-[16px] text-[12px] text-[#7a5312]">
            {exceptionReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <h5 className="mb-[6px] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#736d5f]">
          Source files
        </h5>
        {sources.length === 0 ? (
          <p className="text-[12px] text-[#736d5f]">No source files recorded for this record.</p>
        ) : (
          <ul className="flex flex-col gap-[4px]">
            {sources.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center gap-[6px] text-[12px]">
                <span className="font-medium text-[#3d382f]">{document.filename}</span>
                <span className="text-[#736d5f]">{document.treePath}</span>
                {options.documentHref ? (
                  <a
                    href={options.documentHref(document.id)}
                    download
                    aria-label={`Download ${document.filename}`}
                    className="text-[#736d5f] hover:text-[#2f56d3]"
                  >
                    <Download className="h-[12px] w-[12px]" />
                  </a>
                ) : null}
                {!document.readable ? (
                  <span className="rounded-[4px] bg-[#fbecea] px-[5px] py-[1px] text-[10px] font-semibold text-[#b23b30]">
                    Unreadable
                  </span>
                ) : null}
                {exceptionFileIds.includes(document.id) ? (
                  <span className="rounded-[4px] bg-[#f6e9d8] px-[5px] py-[1px] text-[10px] font-semibold text-[#8a5a1d]">
                    No record
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h5 className="mb-[6px] text-[11px] font-semibold uppercase tracking-[0.05em] text-[#736d5f]">
          Extracted fields
        </h5>
        <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-[12px] gap-y-[6px] sm:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]">
          {pairFields(record.fields).map(([left, right]) => (
            <FieldPair
              key={left.key}
              record={record}
              left={left}
              right={right}
              options={options}
              onInfo={onInfo}
              onEdit={onEdit}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FieldPair({
  record,
  left,
  right,
  options,
  onInfo,
  onEdit,
}: {
  record: ResultRecord;
  left: ResultFieldValue;
  right: ResultFieldValue | null;
  options: ResultGridOptions;
  onInfo: (field: ResultFieldValue) => void;
  onEdit: (record: ResultRecord, field: ResultFieldValue) => void;
}) {
  return (
    <>
      <DetailField record={record} field={left} options={options} onInfo={onInfo} onEdit={onEdit} />
      {right ? (
        <DetailField record={record} field={right} options={options} onInfo={onInfo} onEdit={onEdit} />
      ) : (
        // Keeps the four-column grid rectangular on an odd field count.
        <>
          <span className="hidden sm:block" />
          <span className="hidden sm:block" />
        </>
      )}
    </>
  );
}

function DetailField({
  record,
  field,
  options,
  onInfo,
  onEdit,
}: {
  record: ResultRecord;
  field: ResultFieldValue;
  options: ResultGridOptions;
  onInfo: (field: ResultFieldValue) => void;
  onEdit: (record: ResultRecord, field: ResultFieldValue) => void;
}) {
  return (
    <>
      <span className="text-[12px] text-[#736d5f]">{field.key}</span>
      <span className="flex min-w-0 items-start gap-[6px] text-[12px] text-[#3d382f]">
        <span className="mt-[4px]">
          <ConfidenceDot field={field} recordLabel={record.label} onInfo={() => onInfo(field)} />
        </span>
        <span className="min-w-0 break-words">
          {field.value || <span className="text-[#c9c3b5]">—</span>}
        </span>
        <ProvenanceTag field={field} />
        {options.editing ? (
          <button
            type="button"
            aria-label={`Edit ${field.key} on ${record.label}`}
            onClick={() => onEdit(record, field)}
            className="mt-[2px] shrink-0 text-[#736d5f] hover:text-[#3d382f]"
          >
            <Pencil className="h-[12px] w-[12px]" />
          </button>
        ) : null}
      </span>
    </>
  );
}
