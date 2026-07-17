"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { computePivot, type PivotColumn, type PivotMeasure } from "@rbrasier/domain";
import type { FieldReportSessionRow } from "@rbrasier/domain";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type MeasureKind = "count" | "sum" | "avg";

const selectStyle =
  "h-9 rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 text-[13px] text-[#1a1814] outline-none focus:border-[#3a5fd9] focus:bg-white";

const labelStyle = "block text-[11px] font-medium uppercase tracking-wide text-[#6d6a65] mb-1";

const AXIS_STYLE = { fontSize: 11, fill: "#918d87" };

const SERIES_COLOURS = ["#3a5fd9", "#2e9e6a", "#d98a3a", "#c2385a", "#7c5cbf", "#2f9bb3"];

const groupLabel = (value: string): string => (value === "" ? "(none)" : value);

export function FieldReportPivotDrawer({
  open,
  onOpenChange,
  columns,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: PivotColumn[];
  rows: FieldReportSessionRow[];
}) {
  const numericColumns = useMemo(
    () => columns.filter((column) => column.type === "currency" || column.type === "number"),
    [columns],
  );

  const [groupByKey, setGroupByKey] = useState<string>(columns[0]?.columnKey ?? "");
  const [secondaryGroupByKey, setSecondaryGroupByKey] = useState<string>("");
  const [measureKind, setMeasureKind] = useState<MeasureKind>("count");
  const [measureColumnKey, setMeasureColumnKey] = useState<string>(
    numericColumns[0]?.columnKey ?? "",
  );

  const measure: PivotMeasure = useMemo(() => {
    if (measureKind === "count") return { kind: "count" };
    return { kind: measureKind, columnKey: measureColumnKey };
  }, [measureKind, measureColumnKey]);

  const measureColumn = useMemo(
    () => numericColumns.find((column) => column.columnKey === measureColumnKey),
    [numericColumns, measureColumnKey],
  );

  const pivot = useMemo(
    () =>
      computePivot(rows, {
        columns,
        groupByKey,
        secondaryGroupByKey: secondaryGroupByKey || undefined,
        measure,
      }),
    [rows, columns, groupByKey, secondaryGroupByKey, measure],
  );

  const formatMeasure = (value: number): string => {
    if (measureKind === "count") return value.toLocaleString("en-US");
    const rounded = Math.round(value * 100) / 100;
    const formatted = rounded.toLocaleString("en-US", { maximumFractionDigits: 2 });
    return measureColumn?.type === "currency" ? `$${formatted}` : formatted;
  };

  const chartData = useMemo(() => {
    if (!pivot.secondaryGroups) {
      return pivot.rows.map((pivotRow) => ({
        name: groupLabel(pivotRow.key),
        value: pivotRow.total.value,
      }));
    }
    return pivot.rows.map((pivotRow) => {
      const entry: Record<string, string | number> = { name: groupLabel(pivotRow.key) };
      pivot.secondaryGroups!.forEach((secondary, index) => {
        entry[groupLabel(secondary)] = pivotRow.cells[index]?.value ?? 0;
      });
      return entry;
    });
  }, [pivot]);

  const hasRows = pivot.rows.length > 0;
  const noNumericData = measureKind !== "count" && !pivot.hasNumericData;
  const measureHeading =
    measureKind === "count" ? "Sessions" : `${measureKind === "sum" ? "Sum" : "Avg"} of ${measureColumn?.label ?? "—"}`;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby="pivot-drawer-description">
        <SheetHeader>
          <SheetTitle>Summarise</SheetTitle>
          <SheetDescription id="pivot-drawer-description">
            Group the {rows.length} filtered session{rows.length === 1 ? "" : "s"} and measure them.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-5">
          <div className="grid grid-cols-2 gap-3 rounded-[9px] border border-[#efede8] bg-[#f7f6f3] p-3">
            <div>
              <span className={labelStyle}>Group by</span>
              <select
                aria-label="Group by"
                className={`${selectStyle} w-full`}
                value={groupByKey}
                onChange={(event) => setGroupByKey(event.target.value)}
              >
                {columns.map((column) => (
                  <option key={column.columnKey} value={column.columnKey}>
                    {column.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className={labelStyle}>Then by (optional)</span>
              <select
                aria-label="Then by"
                className={`${selectStyle} w-full`}
                value={secondaryGroupByKey}
                onChange={(event) => setSecondaryGroupByKey(event.target.value)}
              >
                <option value="">— None —</option>
                {columns
                  .filter((column) => column.columnKey !== groupByKey)
                  .map((column) => (
                    <option key={column.columnKey} value={column.columnKey}>
                      {column.label}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <span className={labelStyle}>Measure</span>
              <select
                aria-label="Measure"
                className={`${selectStyle} w-full`}
                value={measureKind}
                onChange={(event) => setMeasureKind(event.target.value as MeasureKind)}
              >
                <option value="count">Count of sessions</option>
                <option value="sum" disabled={numericColumns.length === 0}>
                  Sum
                </option>
                <option value="avg" disabled={numericColumns.length === 0}>
                  Average
                </option>
              </select>
            </div>

            {measureKind !== "count" && (
              <div>
                <span className={labelStyle}>Of column</span>
                <select
                  aria-label="Of column"
                  className={`${selectStyle} w-full`}
                  value={measureColumnKey}
                  onChange={(event) => setMeasureColumnKey(event.target.value)}
                >
                  {numericColumns.map((column) => (
                    <option key={column.columnKey} value={column.columnKey}>
                      {column.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {!hasRows && (
            <p className="text-[13px] text-[#6d6a65]">No sessions match the current filters.</p>
          )}

          {hasRows && noNumericData && (
            <p className="text-[13px] text-[#6d6a65]">
              No numeric data in “{measureColumn?.label ?? "—"}” for the filtered sessions.
            </p>
          )}

          {hasRows && !noNumericData && (
            <>
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#efede8" />
                    <XAxis dataKey="name" tick={AXIS_STYLE} interval={0} />
                    <YAxis tick={AXIS_STYLE} allowDecimals={measureKind !== "count"} />
                    <Tooltip />
                    {pivot.secondaryGroups ? (
                      pivot.secondaryGroups.map((secondary, index) => (
                        <Bar
                          key={secondary}
                          dataKey={groupLabel(secondary)}
                          fill={SERIES_COLOURS[index % SERIES_COLOURS.length]}
                          radius={[3, 3, 0, 0]}
                        />
                      ))
                    ) : (
                      <Bar dataKey="value" name={measureHeading} fill="#3a5fd9" radius={[3, 3, 0, 0]} />
                    )}
                    {pivot.secondaryGroups && <Legend wrapperStyle={{ fontSize: 11 }} />}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Group</TableHead>
                      {pivot.secondaryGroups ? (
                        pivot.secondaryGroups.map((secondary) => (
                          <TableHead key={secondary} className="text-right">
                            {groupLabel(secondary)}
                          </TableHead>
                        ))
                      ) : (
                        <TableHead className="text-right">{measureHeading}</TableHead>
                      )}
                      {pivot.secondaryGroups && <TableHead className="text-right">Total</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pivot.rows.map((pivotRow) => (
                      <TableRow key={pivotRow.key || "(none)"}>
                        <TableCell className="text-[13px]">{groupLabel(pivotRow.key)}</TableCell>
                        {pivot.secondaryGroups ? (
                          pivotRow.cells.map((cell, index) => (
                            <TableCell
                              key={pivot.secondaryGroups![index]}
                              className="text-right text-[13px] tabular-nums"
                            >
                              {formatMeasure(cell.value)}
                            </TableCell>
                          ))
                        ) : (
                          <TableCell className="text-right text-[13px] tabular-nums">
                            {formatMeasure(pivotRow.total.value)}
                          </TableCell>
                        )}
                        {pivot.secondaryGroups && (
                          <TableCell className="text-right text-[13px] font-medium tabular-nums">
                            {formatMeasure(pivotRow.total.value)}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="text-[13px] font-medium">Total</TableCell>
                      {pivot.secondaryGroups ? (
                        pivot.columnTotals.map((cell, index) => (
                          <TableCell
                            key={pivot.secondaryGroups![index]}
                            className="text-right text-[13px] font-medium tabular-nums"
                          >
                            {formatMeasure(cell.value)}
                          </TableCell>
                        ))
                      ) : (
                        <TableCell className="text-right text-[13px] font-medium tabular-nums">
                          {formatMeasure(pivot.grandTotal.value)}
                        </TableCell>
                      )}
                      {pivot.secondaryGroups && (
                        <TableCell className="text-right text-[13px] font-medium tabular-nums">
                          {formatMeasure(pivot.grandTotal.value)}
                        </TableCell>
                      )}
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
