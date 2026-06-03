"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";
import { FieldReportSection } from "@/components/admin/field-report-section";

const AXIS_STYLE = { fontSize: 11, fill: "#918d87" };
const FLOW_CARD_THRESHOLD = 5;

const formatDuration = (seconds: number): string => {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
};

const completionColour = (rate: number): string => {
  if (rate >= 75) return "#2e9e6a";
  if (rate >= 40) return "#d98a3a";
  return "#c2385a";
};

const truncate = (value: string, max = 14): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export function AdminFlowDeepDive() {
  const [selectedFlowId, setSelectedFlowId] = useState<string | undefined>(undefined);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const deepDiveQuery = trpc.analytics.flowDeepDive.useQuery({ flowId: selectedFlowId });

  useEffect(() => {
    if (!showSearch) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowSearch(false);
        setSearchQuery("");
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [showSearch]);
  const data = deepDiveQuery.data;

  if (deepDiveQuery.isLoading || !data) {
    return (
      <div className="h-full overflow-auto">
        <div className="container py-8 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (data.flows.length === 0) {
    return (
      <div className="h-full overflow-auto">
        <div className="container py-8 text-sm text-muted-foreground">
          No flows yet. Create a flow and run some sessions to see insights here.
        </div>
      </div>
    );
  }

  const activeFlowId = selectedFlowId ?? data.selectedFlowId ?? undefined;
  const confidenceData = data.nodeBreakdown.map((node) => ({
    name: truncate(node.nodeName),
    value: node.averageConfidenceAtCompletion ?? 0,
  }));
  const dropOffData = data.nodeBreakdown.map((node) => ({
    name: truncate(node.nodeName),
    value: node.dropOff,
  }));

  return (
    <div className="h-full overflow-auto">
      <div className="container space-y-4 py-8">
        <div>
          <h1 className="text-lg font-semibold text-[#1a1814]">Flow insights</h1>
          <p className="text-[13px] text-[#918d87]">
            Select a flow to see its node-level breakdown and reporting.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(data.flows.length > FLOW_CARD_THRESHOLD
            ? data.flows.slice(0, FLOW_CARD_THRESHOLD)
            : data.flows
          ).map((flow) => {
            const selected = flow.flowId === activeFlowId;
            return (
              <button
                key={flow.flowId}
                type="button"
                onClick={() => setSelectedFlowId(flow.flowId)}
                className={`rounded-[9px] border px-3 py-2 text-left transition-colors ${
                  selected
                    ? "border-[#3a5fd9] bg-[#eef2fd]"
                    : "border-[#dedad2] bg-white hover:bg-[#f7f6f3]"
                }`}
              >
                <span className="block text-[13px] font-medium text-[#1a1814]">
                  {flow.flowName}
                </span>
                <span className="block text-[12px] text-[#918d87]">
                  {flow.sessionCount} session{flow.sessionCount === 1 ? "" : "s"}
                </span>
              </button>
            );
          })}

          {data.flows.length > FLOW_CARD_THRESHOLD && (
            showSearch ? (
              <FlowSearchInput
                flows={data.flows}
                searchQuery={searchQuery}
                containerRef={searchContainerRef}
                onQueryChange={setSearchQuery}
                onSelect={(flowId) => {
                  setSelectedFlowId(flowId);
                  setShowSearch(false);
                  setSearchQuery("");
                }}
                onDismiss={() => {
                  setShowSearch(false);
                  setSearchQuery("");
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowSearch(true)}
                className="rounded-[9px] border border-[#dedad2] bg-white px-3 py-2 text-left transition-colors hover:bg-[#f7f6f3]"
              >
                <span className="block text-[13px] font-medium text-[#918d87]">Search for more</span>
              </button>
            )
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard title="Avg confidence at completion, per step">
            {data.nodeBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={confidenceData} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#efede8" />
                  <XAxis dataKey="name" tick={AXIS_STYLE} interval={0} />
                  <YAxis domain={[0, 100]} tick={AXIS_STYLE} />
                  <Tooltip />
                  <Bar dataKey="value" name="Avg confidence" fill="#3a5fd9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ChartCard>

          <ChartCard title="Drop-off volume, per step">
            {data.nodeBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dropOffData} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#efede8" />
                  <XAxis dataKey="name" tick={AXIS_STYLE} interval={0} />
                  <YAxis allowDecimals={false} tick={AXIS_STYLE} />
                  <Tooltip />
                  <Bar dataKey="value" name="Drop-off" fill="#c2385a" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ChartCard>
        </div>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Node breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Step</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Avg turns</TableHead>
                  <TableHead className="text-right">Avg time</TableHead>
                  <TableHead className="text-right">Avg confidence</TableHead>
                  <TableHead className="text-right">Drop-off</TableHead>
                  <TableHead className="w-[160px]">Completion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.nodeBreakdown.map((node) => (
                  <TableRow key={node.nodeId}>
                    <TableCell className="font-medium">{node.nodeName}</TableCell>
                    <TableCell className="text-right">{node.sessionsVisited}</TableCell>
                    <TableCell className="text-right">{node.averageTurns}</TableCell>
                    <TableCell className="text-right">
                      {formatDuration(node.averageDurationSeconds)}
                    </TableCell>
                    <TableCell className="text-right">
                      {node.averageConfidenceAtCompletion ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{node.dropOff}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#efede8]">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${node.completionRate}%`,
                              backgroundColor: completionColour(node.completionRate),
                            }}
                          />
                        </div>
                        <span className="w-9 text-right text-[12px] text-[#5a5650]">
                          {node.completionRate}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {data.nodeBreakdown.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-[13px] text-[#918d87]">
                      No node activity recorded for this flow yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Suspense>
          <FieldReportSection
            report={data.fieldReport}
            flowId={activeFlowId ?? ""}
            sessionSummary={data.sessionSummary}
          />
        </Suspense>
      </div>
    </div>
  );
}

interface FlowSearchInputProps {
  flows: { flowId: string; flowName: string; sessionCount: number }[];
  searchQuery: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onQueryChange: (query: string) => void;
  onSelect: (flowId: string) => void;
  onDismiss: () => void;
}

function FlowSearchInput({
  flows,
  searchQuery,
  containerRef,
  onQueryChange,
  onSelect,
  onDismiss,
}: FlowSearchInputProps) {
  const filtered = flows.filter((flow) =>
    flow.flowName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div ref={containerRef} className="relative">
      <input
        autoFocus
        type="text"
        value={searchQuery}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDismiss();
        }}
        placeholder="Search flows…"
        className="rounded-[9px] border border-[#3a5fd9] bg-white px-3 py-2 text-[13px] text-[#1a1814] outline-none placeholder:text-[#c4bfb8]"
      />
      {filtered.length > 0 && (
        <ul className="absolute left-0 top-full z-10 mt-1 w-[240px] overflow-hidden rounded-[9px] border border-[#dedad2] bg-white shadow-md">
          {filtered.map((flow) => (
            <li key={flow.flowId}>
              <button
                type="button"
                data-testid="flow-search-option"
                onMouseDown={(event) => {
                  // Prevent input blur before the click registers
                  event.preventDefault();
                  onSelect(flow.flowId);
                }}
                className="w-full px-3 py-2 text-left hover:bg-[#f7f6f3]"
              >
                <span className="block text-[13px] font-medium text-[#1a1814]">
                  {flow.flowName}
                </span>
                <span className="block text-[12px] text-[#918d87]">
                  {flow.sessionCount} session{flow.sessionCount === 1 ? "" : "s"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[260px] w-full">{children}</div>
      </CardContent>
    </Card>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-[#918d87]">
      Not enough data yet.
    </div>
  );
}
