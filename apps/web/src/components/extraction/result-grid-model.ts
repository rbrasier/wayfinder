import type {
  ExtractionDocumentStatus,
  FieldDerivation,
  FieldProvenance,
  FieldSourceRef,
} from "@rbrasier/domain";

export interface ResultDocument {
  id: string;
  filename: string;
  treePath: string;
  readable: boolean;
  status: ExtractionDocumentStatus;
}

export interface ResultFieldValue {
  key: string;
  value: string;
  confidence: number;
  rationale: string;
  // Mirrors the optional members of the domain's ExtractionFieldResult. Absent
  // reads as `processed` through the domain accessor, so a record extracted
  // before ADR-053 renders exactly as it does today.
  provenance?: FieldProvenance;
  sourceRef?: FieldSourceRef;
  derivation?: FieldDerivation;
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

// The table is one column per field, so the columns are the union of the keys
// every record carries. First-seen order keeps the schema's ordering for the
// common case where every record has the same fields, without depending on the
// schema being available client-side.
export const fieldColumnKeys = (records: ResultRecord[]): string[] => {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    for (const field of record.fields) {
      if (seen.has(field.key)) continue;
      seen.add(field.key);
      keys.push(field.key);
    }
  }
  return keys;
};

export const fieldValue = (record: ResultRecord, key: string): ResultFieldValue | null =>
  record.fields.find((field) => field.key === key) ?? null;

// The expanded detail lays fields out four columns wide — field, value, field,
// value — so they are consumed two at a time. The trailing slot is null on an
// odd count, keeping the grid rectangular.
export const pairFields = (
  fields: ResultFieldValue[],
): Array<[ResultFieldValue, ResultFieldValue | null]> => {
  const pairs: Array<[ResultFieldValue, ResultFieldValue | null]> = [];
  for (let index = 0; index < fields.length; index += 2) {
    pairs.push([fields[index]!, fields[index + 1] ?? null]);
  }
  return pairs;
};

export const toggleExpanded = (expanded: Set<string>, recordId: string): Set<string> => {
  const next = new Set(expanded);
  if (next.has(recordId)) {
    next.delete(recordId);
    return next;
  }
  next.add(recordId);
  return next;
};

// A record is an exception when it drew on an exception file, or when every one
// of its fields is empty (nothing was pulled) — the triage the operator filters to.
export const exceptionRecordIds = (result: SampleResult): Set<string> => {
  const exceptionFiles = new Set(result.exceptionFileIds);
  const ids = new Set<string>();
  for (const record of result.records) {
    const drewOnException = record.sourceDocumentIds.some((id) => exceptionFiles.has(id));
    const allBlank = record.fields.every((field) => field.value.trim().length === 0);
    if (drewOnException || allBlank) ids.add(record.id);
  }
  return ids;
};

export interface ExceptionContext {
  exceptionFileIds: readonly string[];
  documents: readonly ResultDocument[];
}

// The "Exception" badge says a row needs triage but not what went wrong, so the
// expanded record spells the reasons out. Ordered widest-first: the record-level
// problem, then the file-level ones in source order.
export const recordExceptionReasons = (
  record: ResultRecord,
  context: ExceptionContext,
): string[] => {
  const reasons: string[] = [];
  const allBlank = record.fields.every((field) => field.value.trim().length === 0);
  if (allBlank) reasons.push("No values were extracted for this record.");

  const documentsById = new Map(context.documents.map((document) => [document.id, document]));
  const exceptionFiles = new Set(context.exceptionFileIds);

  for (const id of record.sourceDocumentIds) {
    const document = documentsById.get(id);
    // A source that vanished from the run still deserves a line — naming the id
    // beats silently dropping the only clue the operator has.
    const label = document?.filename ?? id;
    if (document && !document.readable) reasons.push(`${label} could not be read.`);
    if (exceptionFiles.has(id)) reasons.push(`${label} produced no record.`);
  }

  return reasons;
};

export interface RecordFilter {
  query: string;
  exceptionsOnly: boolean;
}

// The documents the run has not settled yet. They have produced no record to
// show, so the grid lists them under the records it does have — otherwise a run
// halfway through reads as a finished run with rows missing.
export const pendingDocuments = (result: SampleResult, filter: RecordFilter): ResultDocument[] => {
  // Nothing has gone wrong with a document still waiting its turn, so it is not
  // part of the exceptions triage.
  if (filter.exceptionsOnly) return [];

  const needle = filter.query.trim().toLowerCase();
  return result.documents.filter((document) => {
    if (document.status !== "pending" && document.status !== "extracting") return false;
    if (needle.length === 0) return true;
    return (
      document.filename.toLowerCase().includes(needle) ||
      document.treePath.toLowerCase().includes(needle)
    );
  });
};

export const visibleRecords = (result: SampleResult, filter: RecordFilter): ResultRecord[] => {
  const exceptions = exceptionRecordIds(result);
  const needle = filter.query.trim().toLowerCase();
  return result.records.filter((record) => {
    if (filter.exceptionsOnly && !exceptions.has(record.id)) return false;
    if (needle.length === 0) return true;
    return (
      record.label.toLowerCase().includes(needle) ||
      record.fields.some((field) => field.value.toLowerCase().includes(needle))
    );
  });
};
