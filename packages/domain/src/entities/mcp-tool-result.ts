import { domainError } from "../errors/domain-error";
import { err, ok, type Result } from "../result";
import type { ToolRecordCitation } from "./tool-citation";

// MCP has no standard for tool-level cursors, for why a result is empty, or for
// which part of a result is a record, so each is configured per tool by an admin
// (ADR-062 §5). These are pure readers over a tool's structured result.

export interface McpToolPagination {
  // The argument the cursor is sent back in, e.g. "cursor".
  readonly cursorArgument: string;
  // Dotted path to the next cursor in the result; a missing or empty value ends
  // the walk.
  readonly nextCursorPath: string;
  // Dotted path to the array concatenated across pages.
  readonly itemsPath: string;
  readonly maxPages: number;
}

export type McpSourceStatusKind = "ok" | "no-data" | "source-unavailable" | "upstream-gap";

export const MCP_SOURCE_STATUS_KINDS: readonly McpSourceStatusKind[] = [
  "ok",
  "no-data",
  "source-unavailable",
  "upstream-gap",
];

export interface McpToolStatusMapping {
  readonly statusPath: string;
  // The source's own status values mapped to what they mean. A value not in the
  // map reads as `ok`: sources have one success value and several failure ones,
  // and it is the failures an admin needs to name.
  readonly meanings: Record<string, McpSourceStatusKind>;
  readonly caveatsPath: string | null;
}

export interface McpToolCitationMapping {
  readonly recordsPath: string;
  readonly locatorField: string;
  readonly titleField: string | null;
  readonly urlField: string | null;
  readonly timestampField: string | null;
}

export interface McpToolSettings {
  readonly pagination: McpToolPagination | null;
  readonly status: McpToolStatusMapping | null;
  readonly citation: McpToolCitationMapping | null;
}

export const EMPTY_MCP_TOOL_SETTINGS: McpToolSettings = {
  pagination: null,
  status: null,
  citation: null,
};

export interface McpSourceStatus {
  readonly kind: McpSourceStatusKind;
  readonly raw: string;
  readonly caveats: string[];
  readonly confidence: number;
}

// `no-data` is as confident as `ok`: the source answered and said there is
// nothing. `source-unavailable` is zero — the empty result says nothing at all
// about whether records exist.
export const SOURCE_STATUS_CONFIDENCE: Record<McpSourceStatusKind, number> = {
  ok: 1,
  "no-data": 1,
  "upstream-gap": 0.5,
  "source-unavailable": 0,
};

export const MAX_MCP_TOOL_PAGES = 20;

const PATH_PATTERN = /^[A-Za-z_$][\w$]*(\.([A-Za-z_$][\w$]*|\d+))*$/;

export const isValidResultPath = (path: string): boolean => PATH_PATTERN.test(path);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const readPath = (value: unknown, path: string): unknown => {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const scalarText = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
};

const readCaveats = (structured: unknown, caveatsPath: string | null): string[] => {
  if (!caveatsPath) return [];
  const caveats = readPath(structured, caveatsPath);
  if (typeof caveats === "string") return caveats.trim() ? [caveats] : [];
  if (!Array.isArray(caveats)) return [];
  return caveats.filter((caveat): caveat is string => typeof caveat === "string" && caveat.trim().length > 0);
};

export const applyStatusMapping = (
  structured: unknown,
  mapping: McpToolStatusMapping,
): McpSourceStatus | null => {
  const raw = scalarText(readPath(structured, mapping.statusPath));
  if (raw === null) return null;
  const kind = mapping.meanings[raw] ?? "ok";
  return {
    kind,
    raw,
    caveats: readCaveats(structured, mapping.caveatsPath),
    confidence: SOURCE_STATUS_CONFIDENCE[kind],
  };
};

export const sanitizeCitationUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
};

export interface McpResourceLink {
  readonly uri: string;
  readonly name?: string;
  readonly title?: string;
}

export interface CitationOrigin {
  readonly serverId: string;
  readonly serverLabel: string;
  readonly toolName: string;
}

export interface ExtractCitationsInput {
  readonly structured: unknown;
  readonly mapping: McpToolCitationMapping | null;
  readonly resourceLinks: readonly McpResourceLink[];
  readonly origin: CitationOrigin;
}

const optionalField = (record: unknown, field: string | null): string | null => {
  if (!field) return null;
  return scalarText(readPath(record, field));
};

const citationFromRecord = (
  record: unknown,
  mapping: McpToolCitationMapping,
  origin: CitationOrigin,
): ToolRecordCitation | null => {
  const locator = scalarText(readPath(record, mapping.locatorField))?.trim();
  if (!locator) return null;
  return {
    ...origin,
    locator,
    title: optionalField(record, mapping.titleField),
    url: mapping.urlField ? sanitizeCitationUrl(readPath(record, mapping.urlField)) : null,
    recordedAt: optionalField(record, mapping.timestampField),
  };
};

const citationFromLink = (link: McpResourceLink, origin: CitationOrigin): ToolRecordCitation => ({
  ...origin,
  locator: link.uri,
  title: link.title ?? link.name ?? null,
  url: sanitizeCitationUrl(link.uri),
  recordedAt: null,
});

export const extractCitations = (input: ExtractCitationsInput): ToolRecordCitation[] => {
  const candidates: ToolRecordCitation[] = [];
  const mapping = input.mapping;
  const records = mapping ? readPath(input.structured, mapping.recordsPath) : undefined;
  if (mapping && Array.isArray(records)) {
    for (const record of records) {
      const citation = citationFromRecord(record, mapping, input.origin);
      if (citation) candidates.push(citation);
    }
  }
  for (const link of input.resourceLinks) candidates.push(citationFromLink(link, input.origin));

  const seen = new Set<string>();
  return candidates.filter((citation) => {
    if (seen.has(citation.locator)) return false;
    seen.add(citation.locator);
    return true;
  });
};

const writePath = (value: unknown, segments: string[], replacement: unknown): unknown => {
  if (segments.length === 0) return replacement;
  const [head, ...rest] = segments as [string, ...string[]];
  const existing = isRecord(value) ? (value as Record<string, unknown>)[head] : undefined;
  const copy = (Array.isArray(value) ? [...value] : { ...(isRecord(value) ? value : {}) }) as Record<
    string,
    unknown
  >;
  copy[head] = writePath(existing, rest, replacement);
  return copy;
};

// The first page's structure, with its items array replaced by every page's
// items in order. Pages with no array at the path contribute nothing.
export const mergePageItems = (pages: readonly unknown[], itemsPath: string): unknown => {
  const first = pages[0];
  if (!Array.isArray(readPath(first, itemsPath))) return first;
  const items = pages.flatMap((page) => {
    const pageItems = readPath(page, itemsPath);
    return Array.isArray(pageItems) ? pageItems : [];
  });
  return writePath(first, itemsPath.split("."), items);
};

const invalid = (message: string) => err(domainError("VALIDATION_FAILED", message));

const validatePagination = (pagination: McpToolPagination): string | null => {
  if (!pagination.cursorArgument.trim()) return "The cursor argument is required.";
  if (!isValidResultPath(pagination.nextCursorPath)) return "The next-cursor path is not a valid path.";
  if (!isValidResultPath(pagination.itemsPath)) return "The items path is not a valid path.";
  const pagesInRange =
    Number.isInteger(pagination.maxPages) &&
    pagination.maxPages >= 1 &&
    pagination.maxPages <= MAX_MCP_TOOL_PAGES;
  if (!pagesInRange) return `The page limit must be between 1 and ${MAX_MCP_TOOL_PAGES}.`;
  return null;
};

const validateStatus = (status: McpToolStatusMapping): string | null => {
  if (!isValidResultPath(status.statusPath)) return "The status path is not a valid path.";
  const meanings = Object.entries(status.meanings);
  if (meanings.length === 0) return "Map at least one status value.";
  if (meanings.some(([, kind]) => !MCP_SOURCE_STATUS_KINDS.includes(kind))) {
    return "A status value is mapped to an unknown meaning.";
  }
  if (status.caveatsPath !== null && !isValidResultPath(status.caveatsPath)) {
    return "The caveats path is not a valid path.";
  }
  return null;
};

const validateCitation = (citation: McpToolCitationMapping): string | null => {
  const paths = [citation.recordsPath, citation.locatorField];
  const optionalPaths = [citation.titleField, citation.urlField, citation.timestampField];
  for (const path of optionalPaths) if (path !== null) paths.push(path);
  return paths.every(isValidResultPath) ? null : "A citation field is not a valid path.";
};

export const validateMcpToolSettings = (settings: McpToolSettings): Result<McpToolSettings> => {
  const problem =
    (settings.pagination && validatePagination(settings.pagination)) ||
    (settings.status && validateStatus(settings.status)) ||
    (settings.citation && validateCitation(settings.citation));
  if (problem) return invalid(problem);
  return ok(settings);
};
