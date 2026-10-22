"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EventWatch } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PersonPicker } from "@/components/canvas/person-picker";
import { trpc } from "@/trpc/client";
import { ConditionBuilder } from "./condition-builder";
import { JsonFieldPicker } from "./json-field-picker";
import { SELECT_CLASS, WatchConnectionFields } from "./watch-connection-fields";
import {
  canPickRow,
  emptyWatchForm,
  firstItemOf,
  formFromWatch,
  jsonTreeRows,
  pickTargetLabel,
  picksFromItem,
  secretChangeFor,
  watchInputFromForm,
  type PickTarget,
  type WatchForm,
} from "./watch-model";

interface WatchEditorProps {
  // Absent for a new watch.
  existing?: { watch: EventWatch; runAs: { displayName: string | null; email: string } | null };
}

type TestOutcome = { ok: true; status: number; truncated: boolean } | { ok: false; message: string };
type PreviewOutcome =
  | { ok: true; itemCount: number; wouldFire: string[]; skippedWithoutId: number }
  | { ok: false; message: string };

const numberFrom = (value: string): number => (value.trim() === "" ? Number.NaN : Number(value));

// Admin → Event Watch editor (ADR-063 §2): connect, Test to fetch a sample,
// click paths out of it, set the condition, preview it, and map the flow's
// inputs.
export function WatchEditor({ existing }: WatchEditorProps) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const flowsQuery = trpc.eventWatch.flowOptions.useQuery(undefined);
  const [form, setForm] = useState<WatchForm>(() => (existing ? formFromWatch(existing.watch) : emptyWatchForm()));
  const [secret, setSecret] = useState("");
  const [clearSecret, setClearSecret] = useState(false);
  const [runAsName, setRunAsName] = useState(existing?.runAs?.displayName ?? existing?.runAs?.email ?? null);
  const [sample, setSample] = useState<unknown>(undefined);
  const [testOutcome, setTestOutcome] = useState<TestOutcome | null>(null);
  const [previewOutcome, setPreviewOutcome] = useState<PreviewOutcome | null>(null);
  const [pickTarget, setPickTarget] = useState<PickTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const change = (patch: Partial<WatchForm>) => setForm((current) => ({ ...current, ...patch }));
  const done = () => {
    void utils.eventWatch.list.invalidate();
    void utils.eventWatch.countNeedingAttention.invalidate();
    router.push("/admin/event-watches");
  };
  const create = trpc.eventWatch.create.useMutation({ onSuccess: done, onError: (cause) => setError(cause.message) });
  const update = trpc.eventWatch.update.useMutation({ onSuccess: done, onError: (cause) => setError(cause.message) });
  const remove = trpc.eventWatch.delete.useMutation({ onSuccess: done, onError: (cause) => setError(cause.message) });
  const test = trpc.eventWatch.test.useMutation({
    onSuccess: (result) => {
      setTestOutcome(result);
      if (result.ok) setSample(result.sample);
    },
    onError: (cause) => setTestOutcome({ ok: false, message: cause.message }),
  });
  const preview = trpc.eventWatch.preview.useMutation({
    onSuccess: setPreviewOutcome,
    onError: (cause) => setPreviewOutcome({ ok: false, message: cause.message }),
  });

  const flow = flowsQuery.data?.find((option) => option.id === form.flowId);
  const triggerInputs = flow?.triggerInputs ?? [];
  const secretChange = secretChangeFor(secret, clearSecret);

  const runTest = () => {
    const input = watchInputFromForm(form);
    if (input.error !== undefined) {
      setTestOutcome({ ok: false, message: input.error });
      return;
    }
    const { url, method, requestBody, authType, apiKeyPlacement } = input.data;
    test.mutate({
      watchId: existing?.watch.id,
      connection: { url, method, requestBody, authType, apiKeyPlacement },
      secret: secretChange,
    });
  };

  const pick = (path: string) => {
    if (!pickTarget) return;
    if (pickTarget.kind === "items") change({ itemsPath: path });
    if (pickTarget.kind === "item_id") change({ itemIdPath: path });
    if (pickTarget.kind === "condition" && form.condition.kind !== "new_item") {
      change({ condition: { ...form.condition, fieldPath: path } });
    }
    if (pickTarget.kind === "input") change({ inputMapping: { ...form.inputMapping, [pickTarget.key]: path } });
    setPickTarget(null);
  };

  const togglePick = (target: PickTarget) =>
    setPickTarget((current) => (current && JSON.stringify(current) === JSON.stringify(target) ? null : target));
  const isPicking = (target: PickTarget) => JSON.stringify(pickTarget) === JSON.stringify(target);

  const save = () => {
    setError(null);
    const input = watchInputFromForm(form);
    if (input.error !== undefined) {
      setError(input.error);
      return;
    }
    if (existing) {
      update.mutate({ id: existing.watch.id, watch: input.data, secret: secretChange });
      return;
    }
    create.mutate({ watch: input.data, secret: secretChange ?? null });
  };

  const hasSample = sample !== undefined;
  const pickFrom = pickTarget && picksFromItem(pickTarget) ? firstItemOf(sample, form.itemsPath) : sample;
  const saving = create.isPending || update.isPending;
  const pickButton = (target: PickTarget) => (
    <Button
      type="button"
      variant={isPicking(target) ? "default" : "outline"}
      disabled={!hasSample}
      onClick={() => togglePick(target)}
    >
      {isPicking(target) ? "Picking…" : "Pick"}
    </Button>
  );

  return (
    <div className="h-full overflow-auto">
      <div className="container py-8">
        <Link href="/admin/event-watches" className="text-sm text-wf-primary hover:underline">
          ← All watches
        </Link>
        <h1 className="mt-3 text-xl font-semibold">{existing ? existing.watch.name : "New watch"}</h1>
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Connection</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="watch-name">Name</Label>
                  <Input id="watch-name" value={form.name} onChange={(event) => change({ name: event.target.value })} />
                </div>
                <WatchConnectionFields
                  form={form}
                  onChange={change}
                  secret={secret}
                  onSecretChange={setSecret}
                  hasStoredSecret={existing?.watch.hasSecret ?? false}
                  clearSecret={clearSecret}
                  onClearSecretChange={setClearSecret}
                />
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" onClick={runTest} disabled={test.isPending || !form.url}>
                    {test.isPending ? "Testing…" : "Test"}
                  </Button>
                  {testOutcome && (
                    <p role="status" className={`text-sm ${testOutcome.ok ? "text-muted-foreground" : "text-destructive"}`}>
                      {testOutcome.ok
                        ? `The API answered ${testOutcome.status}.${testOutcome.truncated ? " The sample is cut short for display." : ""}`
                        : testOutcome.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Items and condition</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!hasSample && (
                  <p className="text-sm text-muted-foreground">Test the connection to pick fields from a sample.</p>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="watch-items-path">List of items</Label>
                    <div className="flex gap-2">
                      <Input
                        id="watch-items-path"
                        value={form.itemsPath}
                        onChange={(event) => change({ itemsPath: event.target.value })}
                        placeholder="Empty: the response is one item"
                      />
                      {pickButton({ kind: "items" })}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="watch-item-id">Field that identifies each item</Label>
                    <div className="flex gap-2">
                      <Input
                        id="watch-item-id"
                        value={form.itemIdPath}
                        onChange={(event) => change({ itemIdPath: event.target.value })}
                        placeholder="id"
                      />
                      {pickButton({ kind: "item_id" })}
                    </div>
                  </div>
                </div>
                <ConditionBuilder
                  condition={form.condition}
                  onChange={(condition) => change({ condition })}
                  onPickField={() => togglePick({ kind: "condition" })}
                  picking={isPicking({ kind: "condition" })}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!hasSample || preview.isPending}
                    onClick={() =>
                      preview.mutate({
                        sample,
                        itemsPath: form.itemsPath,
                        itemIdPath: form.itemIdPath,
                        condition: form.condition,
                      })
                    }
                  >
                    Would fire now?
                  </Button>
                  {previewOutcome && (
                    <p role="status" className={`text-sm ${previewOutcome.ok ? "text-muted-foreground" : "text-destructive"}`}>
                      {previewOutcome.ok
                        ? `${previewOutcome.wouldFire.length} of ${previewOutcome.itemCount} items would start a run${
                            previewOutcome.wouldFire.length > 0 ? `: ${previewOutcome.wouldFire.slice(0, 10).join(", ")}` : ""
                          }.${previewOutcome.skippedWithoutId > 0 ? ` ${previewOutcome.skippedWithoutId} have no ID and are skipped.` : ""}`
                        : previewOutcome.message}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Flow to start</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="watch-flow">Flow</Label>
                  <select
                    id="watch-flow"
                    className={SELECT_CLASS}
                    value={form.flowId}
                    onChange={(event) => change({ flowId: event.target.value, inputMapping: {} })}
                  >
                    <option value="">Choose a published flow</option>
                    {(flowsQuery.data ?? []).map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
                {flow && triggerInputs.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    This flow declares no inputs. Add them under the flow&apos;s Triggers to pass item values in.
                  </p>
                )}
                {triggerInputs.map((triggerInput) => (
                  <div key={triggerInput.key} className="space-y-1.5">
                    <Label htmlFor={`watch-input-${triggerInput.key}`}>
                      {triggerInput.label || triggerInput.key}
                      {triggerInput.required ? "" : " (optional)"}
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id={`watch-input-${triggerInput.key}`}
                        value={form.inputMapping[triggerInput.key] ?? ""}
                        onChange={(event) =>
                          change({ inputMapping: { ...form.inputMapping, [triggerInput.key]: event.target.value } })
                        }
                        placeholder="Field of the item"
                      />
                      {pickButton({ kind: "input", key: triggerInput.key })}
                    </div>
                  </div>
                ))}
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Runs belong to</p>
                  <p className="text-sm text-muted-foreground">{runAsName ?? "Nobody chosen yet"}</p>
                  <PersonPicker
                    id="watch-run-as"
                    label={runAsName ? "Change person" : "Choose a person"}
                    onPick={(person) => {
                      if (!person.userId) {
                        setError("Runs can only belong to someone with a Wayfinder account.");
                        return;
                      }
                      change({ runAsUserId: person.userId });
                      setRunAsName(person.displayName ?? person.email);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    They own each run, see it in their chats and are told if it fails or needs them.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Schedule and safety</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="watch-interval">Check every (minutes)</Label>
                    <Input
                      id="watch-interval"
                      type="number"
                      min={1}
                      max={1440}
                      value={Number.isNaN(form.intervalMinutes) ? "" : form.intervalMinutes}
                      onChange={(event) => change({ intervalMinutes: numberFrom(event.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="watch-threshold">Pause after failures in a row</Label>
                    <Input
                      id="watch-threshold"
                      type="number"
                      min={1}
                      max={50}
                      value={Number.isNaN(form.failureThreshold) ? "" : form.failureThreshold}
                      onChange={(event) => change({ failureThreshold: numberFrom(event.target.value) })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="watch-cap">Most runs per check</Label>
                    <Input
                      id="watch-cap"
                      type="number"
                      min={1}
                      max={100}
                      value={Number.isNaN(form.maxRunsPerPoll) ? "" : form.maxRunsPerPoll}
                      onChange={(event) => change({ maxRunsPerPoll: numberFrom(event.target.value) })}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.fireOncePerItem}
                    onChange={(event) => change({ fireOncePerItem: event.target.checked })}
                  />
                  Start at most one run per item, ever
                </label>
                <p className="text-xs text-muted-foreground">
                  The first check after saving records what is there and starts nothing. If more items match in one
                  check than the limit allows, the watch pauses instead of starting any.
                </p>
              </CardContent>
            </Card>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={save} disabled={saving}>
                {saving ? "Saving…" : existing ? "Save changes" : "Create watch"}
              </Button>
              <Button asChild variant="outline">
                <Link href="/admin/event-watches">Cancel</Link>
              </Button>
              {existing &&
                (confirmDelete ? (
                  <>
                    <span className="text-sm">Delete this watch? Its runs stay with their owners.</span>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate({ id: existing.watch.id })}
                    >
                      Delete
                    </Button>
                    <Button type="button" variant="ghost" onClick={() => setConfirmDelete(false)}>
                      Keep it
                    </Button>
                  </>
                ) : (
                  <Button type="button" variant="ghost" className="ml-auto" onClick={() => setConfirmDelete(true)}>
                    Delete watch
                  </Button>
                ))}
            </div>
          </div>

          <aside className="space-y-2 lg:sticky lg:top-4 lg:self-start">
            <h2 className="text-sm font-semibold">Sample response</h2>
            {!hasSample ? (
              <p className="text-sm text-muted-foreground">Nothing yet. Use Test to fetch one.</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  {pickTarget
                    ? `Click a field to use it for ${pickTargetLabel(
                        pickTarget,
                        pickTarget.kind === "input"
                          ? triggerInputs.find((triggerInput) => triggerInput.key === pickTarget.key)?.label
                          : undefined,
                      )}.${picksFromItem(pickTarget) ? " Showing the first item." : ""}`
                    : "Use a Pick button, then click a field here."}
                </p>
                {pickFrom === undefined ? (
                  <p className="text-sm text-destructive">There is no list at the items path in this sample.</p>
                ) : (
                  <JsonFieldPicker
                    rows={jsonTreeRows(pickFrom)}
                    canPick={(row) => pickTarget !== null && canPickRow(pickTarget, row)}
                    onPick={pick}
                  />
                )}
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
