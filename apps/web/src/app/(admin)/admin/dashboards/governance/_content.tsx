"use client";

import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/trpc/client";

const BAR_COLOURS = ["#3a5fd9", "#2e9e6a", "#d98a3a", "#8a4fd9", "#d93a6f", "#3ab6d9", "#9ea83a"];
const AXIS_STYLE = { fontSize: 11, fill: "#918d87" };

type Period = "daily" | "weekly" | "monthly";

const money = (value: number): string => `$${value.toFixed(2)}`;

const STATUS_VARIANT: Record<string, { label: string; className: string }> = {
  ok: { label: "ok", className: "bg-[#2e9e6a] text-white" },
  warn: { label: "warn", className: "bg-[#d98a3a] text-white" },
  blocked: { label: "blocked", className: "bg-[#c2385a] text-white" },
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

interface CapForm {
  userId: string;
  period: Period;
  limitUsd: string;
  warnThresholdPct: string;
  enabled: boolean;
}

const emptyForm: CapForm = {
  userId: "",
  period: "monthly",
  limitUsd: "",
  warnThresholdPct: "80",
  enabled: true,
};

export function AdminGovernanceDashboard() {
  const utils = trpc.useUtils();
  const dashboardQuery = trpc.governance.dashboard.useQuery(undefined);
  const budgetsQuery = trpc.governance.budgets.list.useQuery();
  const usersQuery = trpc.user.list.useQuery({});

  const invalidate = () => {
    void utils.governance.dashboard.invalidate();
    void utils.governance.budgets.list.invalidate();
  };

  const createMutation = trpc.governance.budgets.create.useMutation({ onSuccess: invalidate });
  const updateMutation = trpc.governance.budgets.update.useMutation({ onSuccess: invalidate });
  const deleteMutation = trpc.governance.budgets.delete.useMutation({ onSuccess: invalidate });

  const [form, setForm] = useState<CapForm>({ ...emptyForm });

  const userNameById = new Map(
    (usersQuery.data ?? []).map((user) => [user.id, user.name ?? user.email]),
  );

  const dashboard = dashboardQuery.data;
  const spendByUser = (dashboard?.spendByUser ?? []).slice(0, 10).map((row) => ({
    name: row.userName ?? "Unattributed",
    cost: row.totalCostUsd,
  }));
  const spendByFlow = (dashboard?.spendByFlow ?? []).slice(0, 10).map((row) => ({
    name: row.flowName ?? "Unattributed",
    cost: row.totalCostUsd,
  }));

  const onCreate = async (): Promise<void> => {
    const limitUsd = Number(form.limitUsd);
    const warnThresholdPct = Number(form.warnThresholdPct);
    if (!form.userId || !(limitUsd > 0)) return;
    await createMutation.mutateAsync({
      userId: form.userId,
      period: form.period,
      limitUsd,
      warnThresholdPct: Number.isFinite(warnThresholdPct) ? warnThresholdPct : undefined,
      enabled: form.enabled,
    });
    setForm({ ...emptyForm });
  };

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

        <Card>
          <CardHeader>
            <CardTitle>Spend caps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-6 sm:items-end">
              <div className="sm:col-span-2">
                <Label htmlFor="cap-user">User</Label>
                <select
                  id="cap-user"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  value={form.userId}
                  onChange={(e) => setForm({ ...form, userId: e.target.value })}
                >
                  <option value="">Select a user…</option>
                  {usersQuery.data?.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name ?? user.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="cap-period">Period</Label>
                <select
                  id="cap-period"
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  value={form.period}
                  onChange={(e) => setForm({ ...form, period: e.target.value as Period })}
                >
                  <option value="daily">daily</option>
                  <option value="weekly">weekly</option>
                  <option value="monthly">monthly</option>
                </select>
              </div>
              <div>
                <Label htmlFor="cap-limit">Limit (USD)</Label>
                <Input
                  id="cap-limit"
                  type="number"
                  min="0"
                  value={form.limitUsd}
                  onChange={(e) => setForm({ ...form, limitUsd: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="cap-warn">Warn %</Label>
                <Input
                  id="cap-warn"
                  type="number"
                  min="1"
                  max="100"
                  value={form.warnThresholdPct}
                  onChange={(e) => setForm({ ...form, warnThresholdPct: e.target.value })}
                />
              </div>
              <Button onClick={() => void onCreate()} disabled={createMutation.isPending}>
                Add cap
              </Button>
            </div>

            {(budgetsQuery.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No caps configured.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Limit</TableHead>
                    <TableHead className="text-right">Warn %</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {budgetsQuery.data?.map((budget) => (
                    <TableRow key={budget.id}>
                      <TableCell>{userNameById.get(budget.userId) ?? budget.userId}</TableCell>
                      <TableCell>{budget.period}</TableCell>
                      <TableCell className="text-right">{money(budget.limitUsd)}</TableCell>
                      <TableCell className="text-right">{budget.warnThresholdPct}%</TableCell>
                      <TableCell>{budget.enabled ? <Badge>on</Badge> : "off"}</TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            updateMutation.mutate({ id: budget.id, enabled: !budget.enabled })
                          }
                        >
                          {budget.enabled ? "Disable" : "Enable"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteMutation.mutate({ id: budget.id })}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
