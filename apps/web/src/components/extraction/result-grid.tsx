"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import {
  aggregateConfidence,
  confidenceBand,
  recordConfidenceBand,
  type ConfidenceBand,
} from "@rbrasier/domain";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

export function ResultGrid({ result }: { result: SampleResult }) {
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(
    result.records[0]?.id ?? null,
  );
  const [rationale, setRationale] = useState<ResultFieldValue | null>(null);

  const selectedRecord = result.records.find((record) => record.id === selectedRecordId) ?? null;
  const highlightedDocIds = new Set(selectedRecord?.sourceDocumentIds ?? []);

  return (
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
                <span className="block truncate font-medium">{document.filename}</span>
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
            {result.records.map((record) => {
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
                    {field.value || <span className="text-[#b6b1a8]">—</span>}
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
    </div>
  );
}
