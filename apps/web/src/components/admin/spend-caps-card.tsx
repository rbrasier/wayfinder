"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";

type Period = "daily" | "weekly" | "monthly";
type Scope = "everyone" | "role" | "user";

const money = (value: number): string => `$${value.toFixed(2)}`;

interface CapForm {
  scope: Scope;
  roleKey: string;
  userId: string;
  period: Period;
  limitUsd: string;
  warnThresholdPct: string;
  enabled: boolean;
}

const emptyForm: CapForm = {
  scope: "everyone",
  roleKey: "",
  userId: "",
  period: "monthly",
  limitUsd: "",
  warnThresholdPct: "80",
  enabled: true,
};

// Scoped spend-cap CRUD (ADR-031). Rendered on both the Cost governance
// dashboard and the Usage admin screen; the shared tRPC query keys keep their
// caches in sync. A master switch turns enforcement on/off globally.
export function SpendCapsCard() {
  const utils = trpc.useUtils();
  const budgetsQuery = trpc.governance.budgets.list.useQuery();
  const usersQuery = trpc.user.list.useQuery({});
  const rolesQuery = trpc.role.list.useQuery();
  const enabledQuery = trpc.governance.settings.getUsageLimitsEnabled.useQuery();

  const invalidate = () => {
    void utils.governance.dashboard.invalidate();
    void utils.governance.budgets.list.invalidate();
    // The sidebar usage meter reads usage.myUsage; refresh it so adding, editing,
    // or removing a limit updates the meter live without a page reload.
    void utils.usage.myUsage.invalidate();
  };

  const createMutation = trpc.governance.budgets.create.useMutation({ onSuccess: invalidate });
  const updateMutation = trpc.governance.budgets.update.useMutation({ onSuccess: invalidate });
  const deleteMutation = trpc.governance.budgets.delete.useMutation({ onSuccess: invalidate });
  const setEnabledMutation = trpc.governance.settings.setUsageLimitsEnabled.useMutation({
    onSuccess: () => {
      void utils.governance.settings.getUsageLimitsEnabled.invalidate();
      // Flipping the master switch shows/hides the meter for everyone.
      void utils.usage.myUsage.invalidate();
    },
  });

  const [form, setForm] = useState<CapForm>({ ...emptyForm });

  const userNameById = new Map(
    (usersQuery.data ?? []).map((user) => [user.id, user.name ?? user.email]),
  );
  const roleNameByKey = new Map(
    (rolesQuery.data ?? []).map((entry) => [entry.role.key, entry.role.name]),
  );

  const enforcementEnabled = enabledQuery.data ?? true;

  const scopeLabel = (budget: {
    scope: Scope;
    roleKey: string | null;
    userId: string | null;
  }): string => {
    if (budget.scope === "user") {
      return `User: ${budget.userId ? userNameById.get(budget.userId) ?? budget.userId : "—"}`;
    }
    if (budget.scope === "role") {
      return `Role: ${budget.roleKey ? roleNameByKey.get(budget.roleKey) ?? budget.roleKey : "—"}`;
    }
    return "Everyone";
  };

  const onCreate = async (): Promise<void> => {
    const limitUsd = Number(form.limitUsd);
    const warnThresholdPct = Number(form.warnThresholdPct);
    if (!(limitUsd > 0)) return;
    if (form.scope === "user" && !form.userId) return;
    if (form.scope === "role" && !form.roleKey) return;
    await createMutation.mutateAsync({
      scope: form.scope,
      roleKey: form.scope === "role" ? form.roleKey : undefined,
      userId: form.scope === "user" ? form.userId : undefined,
      period: form.period,
      limitUsd,
      warnThresholdPct: Number.isFinite(warnThresholdPct) ? warnThresholdPct : undefined,
      enabled: form.enabled,
    });
    setForm({ ...emptyForm });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage limits</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between rounded-md border border-input px-4 py-3">
          <div>
            <div className="text-sm font-medium">
              Enforcement: {enforcementEnabled ? "On" : "Off"}
            </div>
            <p className="text-sm text-muted-foreground">
              {enforcementEnabled
                ? "Configured limits are enforced. Users see their usage meter."
                : "Enforcement is disabled. You can still pre-configure limits below."}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setEnabledMutation.mutate({ enabled: !enforcementEnabled })}
            disabled={setEnabledMutation.isPending || enabledQuery.isLoading}
          >
            Turn {enforcementEnabled ? "off" : "on"}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-6 sm:items-end">
          <div>
            <Label htmlFor="cap-scope">Scope</Label>
            <select
              id="cap-scope"
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              value={form.scope}
              onChange={(e) =>
                setForm({ ...form, scope: e.target.value as Scope, roleKey: "", userId: "" })
              }
            >
              <option value="everyone">Everyone</option>
              <option value="role">Role</option>
              <option value="user">Specific user</option>
            </select>
          </div>
          {form.scope === "role" && (
            <div>
              <Label htmlFor="cap-role">Role</Label>
              <select
                id="cap-role"
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={form.roleKey}
                onChange={(e) => setForm({ ...form, roleKey: e.target.value })}
              >
                <option value="">Select a role…</option>
                {rolesQuery.data?.map((entry) => (
                  <option key={entry.role.key} value={entry.role.key}>
                    {entry.role.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {form.scope === "user" && (
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
          )}
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
            Add limit
          </Button>
        </div>

        {(budgetsQuery.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No limits configured.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scope</TableHead>
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
                  <TableCell>{scopeLabel(budget)}</TableCell>
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
  );
}
