"use client";

import type { ApiPagingStyle } from "@rbrasier/adapters";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// "none" is a UI-only value: a source that does not paginate stores no paging
// config at all rather than a style saying it has none.
export type PagingStyleChoice = ApiPagingStyle | "none";

export interface LookupSourcePagingDraft {
  style: PagingStyleChoice;
  param: string;
  sizeParam: string;
  size: string;
  cursorPath: string;
  startPage: string;
  maxRecords: string;
}

export const emptyPagingDraft = (): LookupSourcePagingDraft => ({
  style: "none",
  param: "",
  sizeParam: "",
  size: "",
  cursorPath: "",
  startPage: "",
  maxRecords: "",
});

const positiveNumber = (raw: string): number | null => {
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

// A page-number source may legitimately start at 0, so this one accepts it.
const pageNumber = (raw: string): number | null => {
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
};

export const pagingToConfig = (draft: LookupSourcePagingDraft): Record<string, unknown> => {
  if (draft.style === "none" || draft.param.trim().length === 0) return {};

  const size = positiveNumber(draft.size);
  const startPage = pageNumber(draft.startPage);
  const maxRecords = positiveNumber(draft.maxRecords);

  return {
    paging: {
      style: draft.style,
      param: draft.param.trim(),
      ...(draft.sizeParam.trim() ? { sizeParam: draft.sizeParam.trim() } : {}),
      ...(size ? { size } : {}),
      ...(draft.style === "cursor" && draft.cursorPath.trim()
        ? { cursorPath: draft.cursorPath.trim() }
        : {}),
      ...(draft.style === "page" && startPage !== null ? { startPage } : {}),
    },
    ...(maxRecords ? { maxRecords } : {}),
  };
};

export const pagingFromConfig = (config: Record<string, unknown>): LookupSourcePagingDraft => {
  const paging = config.paging as Record<string, unknown> | undefined;
  if (!paging) return { ...emptyPagingDraft(), maxRecords: numberText(config.maxRecords) };

  return {
    style: (paging.style as PagingStyleChoice) ?? "none",
    param: typeof paging.param === "string" ? paging.param : "",
    sizeParam: typeof paging.sizeParam === "string" ? paging.sizeParam : "",
    size: numberText(paging.size),
    cursorPath: typeof paging.cursorPath === "string" ? paging.cursorPath : "",
    startPage: numberText(paging.startPage),
    maxRecords: numberText(config.maxRecords),
  };
};

const numberText = (value: unknown): string => (typeof value === "number" ? String(value) : "");

const STYLE_OPTIONS: Array<{ value: PagingStyleChoice; label: string }> = [
  { value: "none", label: "One response (no paging)" },
  { value: "offset", label: "Offset — counts records" },
  { value: "page", label: "Page number — counts pages" },
  { value: "cursor", label: "Cursor — follows a token" },
];

const PARAM_LABEL: Record<ApiPagingStyle, string> = {
  offset: "Offset parameter",
  page: "Page parameter",
  cursor: "Cursor parameter",
};

interface Props {
  draft: LookupSourcePagingDraft;
  onChange: (patch: Partial<LookupSourcePagingDraft>) => void;
}

// Without this a source only ever contributes its first response, which for a
// large directory silently truncates the value set (ADR-051 §1).
export const LookupSourcePagingFields = ({ draft, onChange }: Props) => (
  <div className="space-y-3 rounded-md border border-border p-3">
    <div className="space-y-1">
      <Label htmlFor="lookup-paging-style">Pagination</Label>
      <select
        id="lookup-paging-style"
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={draft.style}
        onChange={(event) => onChange({ style: event.target.value as PagingStyleChoice })}
      >
        {STYLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        How the source hands over the rest of its list. Leave it on one response unless the source
        returns its values a page at a time.
      </p>
    </div>

    {draft.style === "none" ? null : (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="lookup-paging-param">{PARAM_LABEL[draft.style]}</Label>
          <Input
            id="lookup-paging-param"
            value={draft.param}
            onChange={(event) => onChange({ param: event.target.value })}
            placeholder={draft.style === "cursor" ? "cursor" : "offset"}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="lookup-paging-size-param">Page size parameter</Label>
          <Input
            id="lookup-paging-size-param"
            value={draft.sizeParam}
            onChange={(event) => onChange({ sizeParam: event.target.value })}
            placeholder="limit"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="lookup-paging-size">Records per page</Label>
          <Input
            id="lookup-paging-size"
            value={draft.size}
            onChange={(event) => onChange({ size: event.target.value })}
            placeholder="200"
          />
        </div>

        {draft.style === "cursor" ? (
          <div className="space-y-1">
            <Label htmlFor="lookup-paging-cursor-path">Next-cursor path</Label>
            <Input
              id="lookup-paging-cursor-path"
              value={draft.cursorPath}
              onChange={(event) => onChange({ cursorPath: event.target.value })}
              placeholder="meta.next"
            />
          </div>
        ) : null}

        {draft.style === "page" ? (
          <div className="space-y-1">
            <Label htmlFor="lookup-paging-start-page">First page number</Label>
            <Input
              id="lookup-paging-start-page"
              value={draft.startPage}
              onChange={(event) => onChange({ startPage: event.target.value })}
              placeholder="1"
            />
          </div>
        ) : null}

        <div className="space-y-1">
          <Label htmlFor="lookup-paging-max">Stop after</Label>
          <Input
            id="lookup-paging-max"
            value={draft.maxRecords}
            onChange={(event) => onChange({ maxRecords: event.target.value })}
            placeholder="5000"
          />
          <p className="text-xs text-muted-foreground">Records, across all pages.</p>
        </div>
      </div>
    )}
  </div>
);
