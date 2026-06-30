"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parseNumeric } from "@rbrasier/domain";
import type { FieldReport, FieldReportColumn, FieldReportSessionRow } from "@rbrasier/domain";
import type { SessionSummary } from "@rbrasier/application";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DatePreset = "all" | "this_year" | "last_90" | "last_30";
type FilterOperator = "gte" | "lte";
type StatusFilter = "all" | "complete" | "active" | "abandoned";

// A column as rendered: either a single raw column or several collapsed into
// one. `memberKeys` lists the raw `columnKey`s whose values it coalesces.
interface DisplayColumn {
  columnKey: string;
  nodeId: string;
  nodeName: string;
  fieldKey: string;
  label: string;
  type: FieldReportColumn["type"];
  options?: string[];
  memberKeys: string[];
  stepNames: string[];
}

interface NodeGroup {
  nodeId: string;
  nodeName: string;
  columns: DisplayColumn[];
}

const STORAGE_PREFIX = "wayfinder:field-report";

// First non-empty member value for a collapsed column. Exclusive routing means
// at most one member is populated per session, so order rarely matters; when a
// defensive double-capture occurs we take the first in column order.
const coalesceValue = (values: Record<string, string>, memberKeys: string[]): string => {
  for (const key of memberKeys) {
    const value = values[key];
    if (value !== undefined && value !== "") return value;
  }
  return "";
};

// Union-find over raw columns: two columns merge when they share an *active*
// collapse group (fork-siblings and/or cross-version). Produces one
// DisplayColumn per resulting set, preserving first-seen column order.
const buildDisplayColumns = (
  columns: FieldReportColumn[],
  combineForks: boolean,
  combineVersions: boolean,
): DisplayColumn[] => {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root && parent.get(root) !== undefined) root = parent.get(root)!;
    return root;
  };
  const union = (first: string, second: string): void => {
    parent.set(find(first), find(second));
  };

  for (const column of columns) parent.set(column.columnKey, column.columnKey);

  const firstByGroup = new Map<string, string>();
  for (const column of columns) {
    const groupId =
      (combineForks ? column.collapseGroupId : undefined) ??
      (combineVersions ? column.versionGroupId : undefined);
    if (!groupId) continue;
    const seen = firstByGroup.get(groupId);
    if (seen) union(seen, column.columnKey);
    else firstByGroup.set(groupId, column.columnKey);
  }

  const order: string[] = [];
  const byRoot = new Map<string, FieldReportColumn[]>();
  for (const column of columns) {
    const root = find(column.columnKey);
    const list = byRoot.get(root);
    if (list) {
      list.push(column);
    } else {
      byRoot.set(root, [column]);
      order.push(root);
    }
  }

  return order.map((root) => {
    const members = byRoot.get(root)!;
    const lead = members[0]!;
    const stepNames = [...new Set(members.map((member) => member.nodeName))];
    return {
      columnKey: members.length === 1 ? lead.columnKey : root,
      nodeId: lead.nodeId,
      nodeName: lead.nodeName,
      fieldKey: lead.fieldKey,
      label: lead.label,
      type: lead.type,
      options: lead.options,
      memberKeys: members.map((member) => member.columnKey),
      stepNames,
    };
  });
};

const selectStyle =
  "h-9 rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 text-[13px] text-[#1a1814] outline-none focus:border-[#3a5fd9] focus:bg-white";

const labelStyle = "block text-[11px] font-medium uppercase tracking-wide text-[#6d6a65] mb-1";

const formatDate = (date: Date | string): string =>
  new Date(date).toISOString().slice(0, 10).split("-").reverse().join("-");

const formatStatus = (status: string): string => {
  if (status === "complete") return "Complete";
  if (status === "abandoned") return "Abandoned";
  return "In progress";
};

const statusBadgeClass = (status: string): string => {
  if (status === "complete") return "text-[#247c53]";
  if (status === "abandoned") return "text-[#c2385a]";
  return "text-[#9a6229]";
};

const getDateThreshold = (preset: DatePreset, now: Date): Date | null => {
  if (preset === "all") return null;
  if (preset === "this_year") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  if (preset === "last_90") return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  if (preset === "last_30") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  return null;
};

const formatNumeric = (value: number, type: string): string => {
  if (type === "currency") return `$${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const timeAgo = (date: Date): string => {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
};

export function FieldReportSection({
  report,
  flowId,
  sessionSummary,
}: {
  report: FieldReport;
  flowId: string;
  sessionSummary: SessionSummary;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hasRestoredRef = useRef<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<Date | null>(null);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<string[] | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [combineForks, setCombineForks] = useState(true);
  const [combineVersions, setCombineVersions] = useState(true);

  const datePreset = (searchParams.get("field_date") ?? "all") as DatePreset;
  const filterColumnKey = searchParams.get("field_col") ?? null;
  const filterThreshold = searchParams.get("field_threshold") ?? "";
  const filterOperator = (searchParams.get("field_op") ?? "gte") as FilterOperator;
  const statusFilter = (searchParams.get("field_status") ?? "all") as StatusFilter;

  const filtersStorageKey = `${STORAGE_PREFIX}:${flowId}:filters`;
  const columnsStorageKey = `${STORAGE_PREFIX}:${flowId}:columns`;
  const collapseStorageKey = `${STORAGE_PREFIX}:${flowId}:collapse`;

  const buildParams = useCallback(
    (updates: Partial<{
      datePreset: DatePreset;
      filterColumnKey: string | null;
      filterThreshold: string;
      filterOperator: FilterOperator;
      statusFilter: StatusFilter;
    }>) => {
      const next = {
        datePreset,
        filterColumnKey,
        filterThreshold,
        filterOperator,
        statusFilter,
        ...updates,
      };
      const params = new URLSearchParams(searchParams.toString());
      if (next.datePreset === "all") params.delete("field_date"); else params.set("field_date", next.datePreset);
      if (!next.filterColumnKey) { params.delete("field_col"); params.delete("field_threshold"); params.delete("field_op"); }
      else {
        params.set("field_col", next.filterColumnKey);
        if (!next.filterThreshold) params.delete("field_threshold"); else params.set("field_threshold", next.filterThreshold);
        if (next.filterOperator === "gte") params.delete("field_op"); else params.set("field_op", next.filterOperator);
      }
      if (next.statusFilter === "all") params.delete("field_status"); else params.set("field_status", next.statusFilter);
      return params;
    },
    [searchParams, datePreset, filterColumnKey, filterThreshold, filterOperator, statusFilter],
  );

  const applyFilters = useCallback(
    (updates: Parameters<typeof buildParams>[0]) => {
      const params = buildParams(updates);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [buildParams, router, pathname],
  );

  // Restore from localStorage on mount or flowId change if URL has no filter params
  useEffect(() => {
    if (hasRestoredRef.current === flowId) return;
    hasRestoredRef.current = flowId;

    // Always load column visibility from localStorage
    try {
      const storedCols = localStorage.getItem(columnsStorageKey);
      if (storedCols) setVisibleColumnKeys(JSON.parse(storedCols) as string[]);
    } catch { /* ignore */ }

    // Collapse toggles default ON; only an explicit stored `false` turns one off.
    try {
      const storedCollapse = localStorage.getItem(collapseStorageKey);
      if (storedCollapse) {
        const parsed = JSON.parse(storedCollapse) as Partial<{ forks: boolean; versions: boolean }>;
        if (parsed.forks === false) setCombineForks(false);
        if (parsed.versions === false) setCombineVersions(false);
      }
    } catch { /* ignore */ }

    // Restore filters only if URL has no field filter params
    const hasUrlFilters = ["field_date", "field_col", "field_status"].some((key) => searchParams.has(key));
    if (hasUrlFilters) return;

    try {
      const storedFilters = localStorage.getItem(filtersStorageKey);
      if (!storedFilters) return;
      const parsed = JSON.parse(storedFilters) as Partial<{
        datePreset: DatePreset;
        filterColumnKey: string | null;
        filterThreshold: string;
        filterOperator: FilterOperator;
        statusFilter: StatusFilter;
      }>;
      const params = new URLSearchParams(searchParams.toString());
      let changed = false;
      if (parsed.datePreset && parsed.datePreset !== "all") { params.set("field_date", parsed.datePreset); changed = true; }
      if (parsed.filterColumnKey) { params.set("field_col", parsed.filterColumnKey); changed = true; }
      if (parsed.filterThreshold) { params.set("field_threshold", parsed.filterThreshold); changed = true; }
      if (parsed.filterOperator && parsed.filterOperator !== "gte") { params.set("field_op", parsed.filterOperator); changed = true; }
      if (parsed.statusFilter && parsed.statusFilter !== "all") { params.set("field_status", parsed.statusFilter); changed = true; }
      if (changed) {
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        setRestoredAt(new Date());
      }
    } catch { /* ignore */ }
  }, [flowId, columnsStorageKey, filtersStorageKey, collapseStorageKey, pathname, router, searchParams]);

  // Persist collapse toggles whenever they change
  useEffect(() => {
    if (hasRestoredRef.current !== flowId) return;
    try {
      localStorage.setItem(
        collapseStorageKey,
        JSON.stringify({ forks: combineForks, versions: combineVersions }),
      );
    } catch { /* ignore */ }
  }, [collapseStorageKey, flowId, combineForks, combineVersions]);

  // Persist filter state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(
        filtersStorageKey,
        JSON.stringify({ datePreset, filterColumnKey, filterThreshold, filterOperator, statusFilter }),
      );
    } catch { /* ignore */ }
  }, [filtersStorageKey, datePreset, filterColumnKey, filterThreshold, filterOperator, statusFilter]);

  // Persist column visibility to localStorage
  useEffect(() => {
    if (visibleColumnKeys === null) return;
    try {
      localStorage.setItem(columnsStorageKey, JSON.stringify(visibleColumnKeys));
    } catch { /* ignore */ }
  }, [columnsStorageKey, visibleColumnKeys]);

  const displayColumns = useMemo(
    () => buildDisplayColumns(report.columns, combineForks, combineVersions),
    [report.columns, combineForks, combineVersions],
  );

  const hasForkGroups = useMemo(
    () => report.columns.some((col) => col.collapseGroupId !== undefined),
    [report.columns],
  );
  const hasVersionGroups = useMemo(
    () => report.columns.some((col) => col.versionGroupId !== undefined),
    [report.columns],
  );

  const columnsByNode = useMemo((): NodeGroup[] => {
    const groups = new Map<string, NodeGroup>();
    for (const column of displayColumns) {
      const existing = groups.get(column.nodeId);
      if (existing) {
        existing.columns.push(column);
      } else {
        groups.set(column.nodeId, { nodeId: column.nodeId, nodeName: column.nodeName, columns: [column] });
      }
    }
    return [...groups.values()];
  }, [displayColumns]);

  const effectiveVisibleKeys = useMemo((): Set<string> => {
    if (visibleColumnKeys === null) return new Set(displayColumns.map((col) => col.columnKey));
    const valid = new Set(displayColumns.map((col) => col.columnKey));
    return new Set(visibleColumnKeys.filter((key) => valid.has(key)));
  }, [visibleColumnKeys, displayColumns]);

  const displayedColumns = useMemo(
    () => displayColumns.filter((col) => effectiveVisibleKeys.has(col.columnKey)),
    [displayColumns, effectiveVisibleKeys],
  );

  const filterColumn = useMemo(
    () => displayColumns.find((col) => col.columnKey === filterColumnKey) ?? null,
    [displayColumns, filterColumnKey],
  );

  const filteredRows = useMemo((): FieldReportSessionRow[] => {
    const now = new Date();
    const dateThreshold = getDateThreshold(datePreset, now);

    return report.rows.filter((row) => {
      if (dateThreshold && new Date(row.startedAt) < dateThreshold) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;

      if (filterColumn && filterColumnKey) {
        const rawValue = coalesceValue(row.values, filterColumn.memberKeys);
        if (filterColumn.type === "currency" || filterColumn.type === "number") {
          if (filterThreshold !== "") {
            const threshold = parseNumeric(filterThreshold);
            const rowValue = parseNumeric(rawValue);
            if (threshold !== null && rowValue !== null) {
              if (filterOperator === "gte" && rowValue < threshold) return false;
              if (filterOperator === "lte" && rowValue > threshold) return false;
            }
          }
        } else if (filterColumn.type === "yesno" || filterColumn.type === "section" || filterColumn.options) {
          if (filterThreshold !== "" && rawValue !== filterThreshold) return false;
        }
      }

      return true;
    });
  }, [report.rows, datePreset, statusFilter, filterColumn, filterColumnKey, filterThreshold, filterOperator]);

  const matchStats = useMemo(() => {
    if (!filterColumn || (filterColumn.type !== "currency" && filterColumn.type !== "number")) return null;
    const numbers = filteredRows
      .map((row) => parseNumeric(coalesceValue(row.values, filterColumn.memberKeys)))
      .filter((value): value is number => value !== null);
    if (numbers.length === 0) return null;
    const sum = numbers.reduce((total, value) => total + value, 0);
    return {
      average: sum / numbers.length,
      max: Math.max(...numbers),
      type: filterColumn.type,
    };
  }, [filteredRows, filterColumn]);

  const handleReset = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    ["field_date", "field_col", "field_threshold", "field_op", "field_status"].forEach((key) => params.delete(key));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setRestoredAt(null);
    try { localStorage.removeItem(filtersStorageKey); } catch { /* ignore */ }
  }, [searchParams, router, pathname, filtersStorageKey]);

  const handleColumnsChange = useCallback(
    (columnKey: string, checked: boolean) => {
      setVisibleColumnKeys((previous) => {
        const current = previous ?? displayColumns.map((col) => col.columnKey);
        return checked ? [...current, columnKey] : current.filter((key) => key !== columnKey);
      });
    },
    [displayColumns],
  );

  if (report.columns.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Template field reporting
          </CardTitle>
        </CardHeader>
        <CardContent className="text-[13px] text-[#6d6a65]">
          No template field values captured yet. Add validation annotations to your template tags
          (e.g.{" "}
          <code className="font-mono">
            {"{{ Approval Status (options: Approved, Rejected) }}"}
          </code>
          ) and complete sessions — captured values will appear here.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Template field reporting
          </CardTitle>
          <div className="flex items-center gap-3">
            {hasForkGroups && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-[12px] text-[#5a5650]"
                title="Combine fork-sibling steps that capture the same field into one column"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={combineForks}
                  onChange={(event) => setCombineForks(event.target.checked)}
                />
                Combine forked steps
              </label>
            )}
            {hasVersionGroups && (
              <label
                className="flex cursor-pointer items-center gap-1.5 text-[12px] text-[#5a5650]"
                title="Combine the same field captured across different versions of this flow"
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5"
                  checked={combineVersions}
                  onChange={(event) => setCombineVersions(event.target.checked)}
                />
                Combine across versions
              </label>
            )}
            <button
              type="button"
              onClick={handleReset}
              className="text-[12px] text-[#3a5fd9] hover:underline"
            >
              Reset filters
            </button>
            <Button variant="outline" size="sm" onClick={() => setColumnsOpen(true)}>
              Columns
            </Button>
          </div>
        </div>

        <div className="flex gap-6 border-t pt-3 text-[13px] text-[#5a5650]">
          <span>
            <span className="font-semibold text-[#1a1814]">{sessionSummary.total}</span> sessions
          </span>
          <span>
            <span className="font-semibold text-[#247c53]">{sessionSummary.completed}</span> completed
          </span>
          <span>
            <span className="font-semibold text-[#6d6a65]">
              {sessionSummary.active + sessionSummary.abandoned}
            </span>{" "}
            in progress or abandoned
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-[9px] border border-[#efede8] bg-[#f7f6f3] p-3">
          <div>
            <span className={labelStyle}>Date range</span>
            <select
              className={selectStyle}
              value={datePreset}
              onChange={(event) => applyFilters({ datePreset: event.target.value as DatePreset })}
            >
              <option value="all">All time</option>
              <option value="this_year">This year</option>
              <option value="last_90">Last 90 days</option>
              <option value="last_30">Last 30 days</option>
            </select>
          </div>

          <div>
            <span className={labelStyle}>Filter on</span>
            <select
              className={selectStyle}
              value={filterColumnKey ?? ""}
              onChange={(event) =>
                applyFilters({ filterColumnKey: event.target.value || null, filterThreshold: "", filterOperator: "gte" })
              }
            >
              <option value="">— None —</option>
              {columnsByNode.map((group) => (
                <optgroup key={group.nodeId} label={group.nodeName}>
                  {group.columns.map((col) => (
                    <option key={col.columnKey} value={col.columnKey}>
                      {col.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {filterColumn && (filterColumn.type === "currency" || filterColumn.type === "number") && (
            <div className="flex items-end gap-1">
              <div>
                <span className={labelStyle}>Operator</span>
                <select
                  className={selectStyle}
                  value={filterOperator}
                  onChange={(event) => applyFilters({ filterOperator: event.target.value as FilterOperator })}
                >
                  <option value="gte">≥</option>
                  <option value="lte">≤</option>
                </select>
              </div>
              <div>
                <span className={labelStyle}>Value</span>
                <Input
                  type="number"
                  className="h-9 w-32"
                  placeholder="0"
                  value={filterThreshold}
                  onChange={(event) => applyFilters({ filterThreshold: event.target.value })}
                />
              </div>
            </div>
          )}

          {filterColumn && (filterColumn.type === "yesno" || filterColumn.type === "section") && (
            <div>
              <span className={labelStyle}>Value</span>
              <select
                className={selectStyle}
                value={filterThreshold}
                onChange={(event) => applyFilters({ filterThreshold: event.target.value })}
              >
                <option value="">Either</option>
                <option value="Yes">Yes</option>
                <option value="No">No</option>
              </select>
            </div>
          )}

          {filterColumn && filterColumn.options && filterColumn.options.length > 0 && (
            <div>
              <span className={labelStyle}>Value</span>
              <select
                className={selectStyle}
                value={filterThreshold}
                onChange={(event) => applyFilters({ filterThreshold: event.target.value })}
              >
                <option value="">Any</option>
                {filterColumn.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <span className={labelStyle}>Status</span>
            <select
              className={selectStyle}
              value={statusFilter}
              onChange={(event) => applyFilters({ statusFilter: event.target.value as StatusFilter })}
            >
              <option value="all">All</option>
              <option value="complete">Completed</option>
              <option value="active">In progress</option>
              <option value="abandoned">Abandoned</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-[#6d6a65]">
          <span>
            <span className="font-medium text-[#1a1814]">{filteredRows.length}</span> of{" "}
            {report.rows.length} sessions match
          </span>
          {matchStats && (
            <>
              <span>·</span>
              <span>Avg {formatNumeric(matchStats.average, matchStats.type)}</span>
              <span>·</span>
              <span>Max {formatNumeric(matchStats.max, matchStats.type)}</span>
            </>
          )}
          {restoredAt && (
            <>
              <span>·</span>
              <span>Filters restored {timeAgo(restoredAt)}</span>
            </>
          )}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[110px]">Started</TableHead>
                <TableHead className="w-[110px]">Status</TableHead>
                {displayedColumns.map((col) => (
                  <TableHead key={col.columnKey}>
                    {col.label}
                    {col.stepNames.length > 1 && (
                      <span className="block text-[10px] font-normal normal-case text-[#6d6a65]">
                        {col.stepNames.join(" · ")}
                      </span>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={2 + displayedColumns.length}
                    className="text-center text-[13px] text-[#6d6a65]"
                  >
                    No sessions match the current filters.
                  </TableCell>
                </TableRow>
              )}
              {filteredRows.map((row) => (
                <TableRow key={row.sessionId}>
                  <TableCell className="whitespace-nowrap text-[12px] text-[#6d6a65]">
                    {formatDate(row.startedAt)}
                  </TableCell>
                  <TableCell className={`text-[12px] font-medium ${statusBadgeClass(row.status)}`}>
                    {formatStatus(row.status)}
                  </TableCell>
                  {displayedColumns.map((col) => (
                    <TableCell key={col.columnKey} className="max-w-[220px] truncate text-[13px]">
                      {coalesceValue(row.values, col.memberKeys) || "—"}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={columnsOpen} onOpenChange={setColumnsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Columns</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div>
              <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[#6d6a65]">
                Always shown
              </p>
              <div className="space-y-2">
                {["Started", "Status"].map((label) => (
                  <label key={label} className="flex cursor-not-allowed items-center gap-2 text-[13px] text-[#6d6a65]">
                    <input type="checkbox" checked disabled className="h-3.5 w-3.5" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            {columnsByNode.map((group) => (
              <div key={group.nodeId}>
                <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-[#6d6a65]">
                  {group.nodeName}
                </p>
                <div className="space-y-2">
                  {group.columns.map((col) => (
                    <label
                      key={col.columnKey}
                      className="flex cursor-pointer items-center gap-2 text-[13px] text-[#1a1814]"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={effectiveVisibleKeys.has(col.columnKey)}
                        onChange={(event) => handleColumnsChange(col.columnKey, event.target.checked)}
                      />
                      {col.label}
                      <span className="ml-auto text-[11px] uppercase tracking-wide text-[#6d6a65]">
                        {col.type}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
