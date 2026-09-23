"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SpendCapsCard } from "@/components/admin/spend-caps-card";
import { trpc } from "@/trpc/client";
import { DATA_INDIGO } from "@/lib/data-colours";

const BAR_COLOURS = [DATA_INDIGO, "#1f6b4d", "#d98a3a", "#8a4fd9", "#d93a6f", "#3ab6d9", "#9ea83a"];
const AXIS_STYLE = { fontSize: 11, fill: "#736d5f" };

const money = (value: number): string => `$${value.toFixed(2)}`;

const STATUS_VARIANT: Record<string, { label: string; className: string }> = {
  ok: { label: "ok", className: "bg-[#1f6b4d] text-white" },
  warn: { label: "warn", className: "bg-[#d98a3a] text-white" },
  blocked: { label: "blocked", className: "bg-[#a8324c] text-white" },
};

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminGovernanceDashboard() {
  const dashboardQuery = trpc.governance.dashboard.useQuery(undefined);

  const dashboard = dashboardQuery.data;
  const spendByUser = (dashboard?.spendByUser ?? []).slice(0, 10).map((row) => ({
    name: row.userName ?? "Unattributed",
    cost: row.totalCostUsd,
  }));
  const spendByFlow = (dashboard?.spendByFlow ?? []).slice(0, 10).map((row) => ({
    name: row.flowName ?? "Unattributed",
    cost: row.totalCostUsd,
  }));

  return (
    <div className="h-full overflow-auto">
      <div className="container space-y-4 py-8">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total spend (last {dashboard?.periodDays ?? 30} days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{money(dashboard?.totalCostUsd ?? 0)}</p>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Spend by user">
            <BarChart data={spendByUser} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={AXIS_STYLE} tickFormatter={(v) => money(Number(v))} />
              <YAxis type="category" dataKey="name" tick={AXIS_STYLE} width={120} />
              <Tooltip formatter={(v) => money(Number(v))} />
              <Bar dataKey="cost">
                {spendByUser.map((_, index) => (
                  <Cell key={index} fill={BAR_COLOURS[index % BAR_COLOURS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ChartCard>

          <ChartCard title="Spend by flow">
            <BarChart data={spendByFlow} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={AXIS_STYLE} tickFormatter={(v) => money(Number(v))} />
              <YAxis type="category" dataKey="name" tick={AXIS_STYLE} width={120} />
              <Tooltip formatter={(v) => money(Number(v))} />
              <Bar dataKey="cost">
                {spendByFlow.map((_, index) => (
                  <Cell key={index} fill={BAR_COLOURS[index % BAR_COLOURS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ChartCard>
        </div>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cap utilisation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(dashboard?.utilisation.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No enabled caps.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Limit</TableHead>
                    <TableHead className="text-right">Used</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard?.utilisation.map((row) => {
                    const status = STATUS_VARIANT[row.status] ?? STATUS_VARIANT.ok!;
                    return (
                      <TableRow key={row.budgetId}>
                        <TableCell>{row.userName ?? row.userId}</TableCell>
                        <TableCell>{row.period}</TableCell>
                        <TableCell className="text-right">{money(row.spendUsd)}</TableCell>
                        <TableCell className="text-right">{money(row.limitUsd)}</TableCell>
                        <TableCell className="text-right">{Math.round(row.ratio * 100)}%</TableCell>
                        <TableCell>
                          <Badge className={status.className}>{status.label}</Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <SpendCapsCard />
      </div>
    </div>
  );
}
