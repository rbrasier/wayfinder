import { domainError } from "../errors/domain-error";
import { err, ok } from "../result";
import type { Result } from "../result";

// A registered source of field values. `name` is the slug an author writes in a
// template tag — `{{ Department (options-source: departments) }}` — so it is the
// public identifier and must stay stable once templates reference it (ADR-050 §1).
export type LookupSourceKind = "directory" | "managed" | "api";

const LOOKUP_SOURCE_KINDS: readonly LookupSourceKind[] = ["directory", "managed", "api"];

// Above this many entries a set is not inlined into the extraction prompt: the
// model proposes from context and the step-end resolve is what guarantees
// correctness (ADR-050 §4). Hard-coded for this version, not configurable.
export const INLINE_OPTIONS_THRESHOLD = 30;

// How many options a conversational question shows when asking. Deliberately
// independent of inlining — the model may hold all 30 while the operator is
// shown 3 and an "ask to see all" affordance (ADR-050 §4).
export const CONVERSATION_PREVIEW_LIMIT = 3;

export const DEFAULT_CACHE_TTL_SECONDS = 3600;

// How many records `probe` returns for the admin to eyeball when picking the
// display and key fields (ADR-050 §2b).
export const PROBE_SAMPLE_LIMIT = 10;

// Bounds on the walk that discovers record collections in a source's response.
// The body is admin-supplied and unvalidated, so these are a guard, not a
// nicety: without them a deeply nested or very wide document walks forever.
export const COLLECTION_WALK_MAX_DEPTH = 6;
export const COLLECTION_WALK_MAX_COLLECTIONS = 20;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface LookupSourceConfig {
  readonly [key: string]: unknown;
}

export interface LookupSource {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly kind: LookupSourceKind;
  readonly config: LookupSourceConfig;
  readonly displayField: string;
  readonly keyField?: string;
  // Whether a credential is stored, never the credential itself. The secret is
  // encrypted at rest and read only by the adapter making the call, so it never
  // rides the read model or reaches a client (ADR-050 §2a).
  readonly credentialSet: boolean;
  readonly cacheTtlSeconds: number;
  readonly enabled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewLookupSource {
  readonly name: string;
  readonly label: string;
  readonly kind: LookupSourceKind;
  readonly config: LookupSourceConfig;
  readonly displayField: string;
  readonly keyField?: string;
  // The secret in plaintext, encrypted by the repository before it is stored.
  // `undefined` on an update means "keep the stored one" — the same semantics as
  // the n8n API key; an empty string clears it.
  readonly credential?: string | null;
  readonly cacheTtlSeconds: number;
  readonly enabled: boolean;
}

// One resolved option. `key` is present only when the source declares a key
// field; the document renders `display`, reporting reads `key`.
export interface ValueSetEntry {
  readonly display: string;
  readonly key?: string;
}

// One array-of-records found in a source's response. `path` is the dotted route
// to it — empty for the response itself — and becomes the source's recordsPath.
export interface RecordCollection {
  readonly path: string;
  readonly count: number;
  readonly fields: string[];
  readonly sample: Array<Record<string, string>>;
}

// What `probe` returns so an admin can pick the list they want and then choose
// which of its fields is the display and which is the key (ADR-050 §2b).
export interface ValueSetProbe {
  readonly collections: RecordCollection[];
}

export interface ValueSetPreview {
  readonly shown: ValueSetEntry[];
  readonly remaining: number;
  readonly totalCount: number;
}

// The audit record of which source version validated a stored value. Written at
// step end and never rewritten, so a later rename does not change history.
export interface FieldValueSnapshot {
  readonly name: string;
  readonly version: string;
  readonly fetchedAt: Date;
  // What was actually typed or proposed, when the step-end check accepted a
  // near-certain misspelling of an entry rather than the entry itself. Absent
  // when the value matched outright, so its presence is the audit record that a
  // correction happened and what it corrected (ADR-050 §6).
  readonly correctedFrom?: string;
}

export const isLookupSourceKind = (value: string): value is LookupSourceKind =>
  LOOKUP_SOURCE_KINDS.includes(value as LookupSourceKind);

// Selection surfaces show both parts so an operator can tell two identically
// labelled entries apart. The generated document is exempt — it renders the
// display alone (ADR-050 §3).
export const formatValueSetEntry = (entry: ValueSetEntry): string => {
  if (!entry.key) return entry.display;
  return `${entry.display} (${entry.key})`;
};

export const previewValueSetEntries = (entries: ValueSetEntry[]): ValueSetPreview => {
  const shown = entries.slice(0, CONVERSATION_PREVIEW_LIMIT);

  return {
    shown,
    remaining: Math.max(entries.length - shown.length, 0),
    totalCount: entries.length,
  };
};

export const probeFieldNames = (sample: Array<Record<string, string>>): string[] => {
  const names: string[] = [];

  sample.forEach((record) => {
    Object.keys(record).forEach((field) => {
      if (names.includes(field)) return;
      names.push(field);
    });
  });

  return names;
};

// A refresh that returns the same content reuses the existing version, so a Test
// run or a TTL expiry does not churn the snapshots already written against it
// (ADR-050 §5). Order is not compared — no source guarantees it.
export const entriesMatchVersion = (
  current: ValueSetEntry[],
  candidate: ValueSetEntry[],
): boolean => {
  if (current.length !== candidate.length) return false;

  // NUL separates the parts because it cannot occur in either: a space would let
  // { display: "A B", key: "" } collide with { display: "A", key: "B" } and
  // reuse a version across two genuinely different sets. Same idiom as chunkKey.
  const fingerprint = (entries: ValueSetEntry[]): string[] =>
    entries.map((entry) => `${entry.display}\u0000${entry.key ?? ""}`).sort();

  const currentFingerprint = fingerprint(current);

  return fingerprint(candidate).every((value, index) => value === currentFingerprint[index]);
};

export const validateNewLookupSource = (input: NewLookupSource): Result<NewLookupSource> => {
  const name = input.name.trim();
  if (!NAME_PATTERN.test(name)) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Lookup source name "${input.name}" is not a valid slug. Use lowercase letters, numbers and hyphens.`,
      ),
    );
  }

  const label = input.label.trim();
  if (label.length === 0) {
    return err(domainError("VALIDATION_FAILED", `Lookup source "${name}" needs a label.`));
  }

  if (!isLookupSourceKind(input.kind)) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Lookup source "${name}" has an unknown kind "${input.kind}". Use directory, managed or api.`,
      ),
    );
  }

  const displayField = input.displayField.trim();
  if (displayField.length === 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Lookup source "${name}" needs a display field. Test the source and choose one of its fields.`,
      ),
    );
  }

  if (!Number.isInteger(input.cacheTtlSeconds) || input.cacheTtlSeconds <= 0) {
    return err(
      domainError(
        "VALIDATION_FAILED",
        `Lookup source "${name}" needs a positive cache TTL in seconds.`,
      ),
    );
  }

  const keyField = input.keyField?.trim();

  return ok({
    ...input,
    name,
    label,
    displayField,
    keyField: keyField && keyField.length > 0 ? keyField : undefined,
  });
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Every scalar becomes a string so any field can serve as the display or the
// key, whatever the source's JSON types. Nested values are dropped: a field the
// admin cannot render is not a field they can choose.
const toSampleRecord = (value: Record<string, unknown>): Record<string, string> => {
  const record: Record<string, string> = {};
  Object.entries(value).forEach(([field, raw]) => {
    if (raw === null || raw === undefined || typeof raw === "object") return;
    record[field] = String(raw);
  });
  return record;
};

const toCollection = (path: string, rows: Record<string, unknown>[]): RecordCollection => {
  const sample = rows.slice(0, PROBE_SAMPLE_LIMIT).map(toSampleRecord);
  const fields: string[] = [];
  rows.forEach((row) => {
    Object.keys(row).forEach((field) => {
      if (fields.includes(field)) return;
      if (typeof row[field] === "object" && row[field] !== null) return;
      fields.push(field);
    });
  });

  return { path, count: rows.length, fields, sample };
};

const isRecordArray = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.length > 0 && value.every(isPlainObject);

// Walks a source's response and reports every array of records in it, so the
// admin picks the list from what actually came back rather than typing a path
// from memory (ADR-050 §2b). Bounded in depth and breadth — the body is
// admin-supplied and may be hostile or malformed.
export const findRecordCollections = (body: unknown): RecordCollection[] => {
  const collections: RecordCollection[] = [];

  const walk = (value: unknown, path: string, depth: number): void => {
    if (depth > COLLECTION_WALK_MAX_DEPTH) return;
    if (collections.length >= COLLECTION_WALK_MAX_COLLECTIONS) return;

    if (isRecordArray(value)) {
      collections.push(toCollection(path, value));
      return;
    }
    if (!isPlainObject(value)) return;

    Object.entries(value).forEach(([field, child]) => {
      walk(child, path ? `${path}.${field}` : field, depth + 1);
    });
  };

  walk(body, "", 0);
  return collections;
};
