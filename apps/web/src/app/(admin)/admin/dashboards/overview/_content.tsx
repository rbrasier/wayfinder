"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/trpc/client";

const DONUT_COLOURS = ["#3a5fd9", "#2e9e6a", "#d98a3a", "#8a4fd9", "#d93a6f", "#3ab6d9", "#9ea83a"];
const AXIS_STYLE = { fontSize: 11, fill: "#918d87" };

interface MetricWithDelta {
  value: number;
  previousValue: number;
  deltaPct: number | null;
}

function DeltaBadge({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct === null) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-[#6d6a65]">
        <Minus size={12} /> no prior data
      </span>
    );
  }
  const rounded = Math.round(deltaPct);
  if (rounded === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-[#6d6a65]">
        <Minus size={12} /> 0%
      </span>
    );
  }
  const positive = rounded > 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[12px] font-medium ${
        positive ? "text-[#247c53]" : "text-[#c2385a]"
      }`}
    >
      {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      {Math.abs(rounded)}% vs prior period
    </span>
  );
}

function MetricCard({
  title,
  metric,
  suffix = "",
}: {
  title: string;
  metric: MetricWithDelta;
  suffix?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-bold">
          {metric.value.toLocaleString()}
          {suffix}
        </p>
        <DeltaBadge deltaPct={metric.deltaPct} />
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[280px] w-full">{children}</div>
      </CardContent>
    </Card>
  );
}

export function AdminOverviewDashboard() {
  const overviewQuery = trpc.analytics.overview.useQuery(undefined);
  const data = overviewQuery.data;

  if (overviewQuery.isLoading || !data) {
    return (
      <div className="h-full overflow-auto">
        <div className="container py-8 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  const hasActivity = data.activity.some((point) => point.started > 0 || point.completed > 0);
  const hasDistribution = data.flowDistribution.length > 0;
  const hasConfidence = data.confidenceLifecycle.some((point) => point.sampleCount > 0);

  return (
    <div className="h-full overflow-auto">
      <div className="container space-y-4 py-8">
        <div>
          <h1 className="text-lg font-semibold text-[#1a1814]">Overview</h1>
          <p className="text-[13px] text-[#6d6a65]">
            Last {data.periodDays} days, compared with the prior {data.periodDays} days.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard title="Active sessions" metric={data.metrics.activeSessions} />
          <MetricCard title="Completions" metric={data.metrics.completions} />
          <MetricCard title="Completion rate" metric={data.metrics.completionRate} suffix="%" />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ChartCard title="Daily sessions — started vs completed">
              {hasActivity ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.activity} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#efede8" />
                    <XAxis dataKey="date" tick={AXIS_STYLE} tickFormatter={(value: string) => value.slice(5)} />
                    <YAxis tick={AXIS_STYLE} allowDecimals={false} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="started" name="Started" stroke="#3a5fd9" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="completed" name="Completed" stroke="#2e9e6a" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart />
              )}
            </ChartCard>
          </div>

          <ChartCard title="Flow distribution">
            {hasDistribution ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.flowDistribution}
                    dataKey="count"
                    nameKey="flowName"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {data.flowDistribution.map((slice, index) => (
                      <Cell key={slice.flowId} fill={DONUT_COLOURS[index % DONUT_COLOURS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </ChartCard>
        </div>

        <ChartCard title="AI confidence across a session lifetime">
          {hasConfidence ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={data.confidenceLifecycle}
                margin={{ top: 8, right: 12, bottom: 0, left: -16 }}
              >
                <defs>
                  <linearGradient id="confidenceFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3a5fd9" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#3a5fd9" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#efede8" />
                <XAxis
                  dataKey="positionPct"
                  tick={AXIS_STYLE}
                  tickFormatter={(value: number) => `${value}%`}
                />
                <YAxis domain={[0, 100]} tick={AXIS_STYLE} />
                <Tooltip
                  formatter={(value: number) => [`${value}`, "Avg confidence"]}
                  labelFormatter={(label: number) => `${label}% through session`}
                />
                <Area
                  type="monotone"
                  dataKey="averageConfidence"
                  stroke="#3a5fd9"
                  strokeWidth={2}
                  fill="url(#confidenceFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart />
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="flex h-full items-center justify-center text-[13px] text-[#6d6a65]">
      Not enough data yet.
    </div>
  );
}
