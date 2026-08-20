"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  DEFAULT_CACHE_TTL_SECONDS,
  formatValueSetEntry,
  type LookupSourceKind,
  type RecordCollection,
  type ValueSetEntry,
} from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogCloseButton, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

export interface LookupSourceDraft {
  id: string | null;
  name: string;
  label: string;
  kind: LookupSourceKind;
  url: string;
  searchParam: string;
  recordsPath: string;
  directoryQuery: string;
  // Typed by the admin. Blank on an existing source means "keep the stored one".
  credential: string;
  credentialSet: boolean;
  displayField: string;
  keyField: string;
  cacheTtlSeconds: number;
}

export const emptyDraft = (): LookupSourceDraft => ({
  id: null,
  name: "",
  label: "",
  kind: "directory",
  url: "",
  searchParam: "",
  recordsPath: "",
  directoryQuery: "",
  credential: "",
  credentialSet: false,
  displayField: "",
  keyField: "",
  cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
});

// Only the fields that kind actually uses reach the stored config, so a source
// switched from api to directory does not carry a stale URL.
export const draftToConfig = (draft: LookupSourceDraft): Record<string, unknown> => {
  if (draft.kind === "api") {
    return {
      url: draft.url.trim(),
      ...(draft.searchParam.trim() ? { searchParam: draft.searchParam.trim() } : {}),
      ...(draft.recordsPath.trim() ? { recordsPath: draft.recordsPath.trim() } : {}),
    };
  }
  if (draft.kind === "directory" && draft.directoryQuery.trim()) {
    return { query: draft.directoryQuery.trim() };
  }
  return {};
};

export const draftToInput = (draft: LookupSourceDraft) => ({
  name: draft.name.trim(),
  label: draft.label.trim(),
  kind: draft.kind,
  config: draftToConfig(draft),
  displayField: draft.displayField.trim(),
  ...(draft.keyField.trim() ? { keyField: draft.keyField.trim() } : {}),
  // Omitted when blank so the stored secret survives an edit that does not
  // touch it — the same rule the n8n API key follows.
  ...(draft.credential.length > 0 ? { credential: draft.credential } : {}),
  cacheTtlSeconds: draft.cacheTtlSeconds,
  enabled: true,
});

// The admin cannot pick a display field until Test has told them what the source
// returns, so saving is gated on having run it (ADR-050 §2b).
export const draftSaveBlocker = (draft: LookupSourceDraft): string | null => {
  if (draft.name.trim().length === 0) return "Give the source a name.";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.name.trim())) {
    return "The name must be lowercase letters, numbers and hyphens — it is what templates reference.";
  }
  if (draft.label.trim().length === 0) return "Give the source a label.";
  if (draft.kind === "api" && draft.url.trim().length === 0) return "Give the source a URL.";
  if (draft.displayField.trim().length === 0) return "Test the source and choose a display field.";
  return null;
};

// A single list needs no choosing; several are offered by path, with the record
// count and field names so the admin can tell them apart (ADR-050 §2b).
export const collectionLabel = (collection: RecordCollection): string => {
  const path = collection.path || "(whole response)";
  const fields = collection.fields.slice(0, 4).join(", ");
  return `${path} · ${collection.count} records${fields ? ` · ${fields}` : ""}`;
};

export const fieldsForCollection = (
  collections: RecordCollection[],
  recordsPath: string,
): string[] => collections.find((collection) => collection.path === recordsPath)?.fields ?? [];

export const sampleForCollection = (
  collections: RecordCollection[],
  recordsPath: string,
): Array<Record<string, string>> =>
  collections.find((collection) => collection.path === recordsPath)?.sample ?? [];

export const previewRows = (
  sample: Array<Record<string, string>>,
  displayField: string,
  keyField: string,
): string[] => {
  if (displayField.trim().length === 0) return [];

  return sample
    .map((record) => {
      const key = keyField.trim() ? record[keyField.trim()] : undefined;
      const entry: ValueSetEntry = {
        display: (record[displayField.trim()] ?? "").trim(),
        ...(key ? { key } : {}),
      };
      return entry;
    })
    // A record with no value in the display field is dropped, matching what the
    // provider does — an entry is nothing without something to show.
    .filter((entry) => entry.display.length > 0)
    .map(formatValueSetEntry);
};

const KIND_LABELS: Record<LookupSourceKind, string> = {
  directory: "People directory",
  managed: "Managed list",
  api: "API endpoint",
};

export function LookupSourcesCard() {
  const utils = trpc.useUtils();
  const sourcesQuery = trpc.lookupSource.list.useQuery();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LookupSourceDraft>(emptyDraft());
  const [collections, setCollections] = useState<RecordCollection[]>([]);

  const closeEditor = async () => {
    setOpen(false);
    setCollections([]);
    await utils.lookupSource.list.invalidate();
  };

  const testMutation = trpc.lookupSource.test.useMutation({
    onSuccess: (result) => {
      setCollections(result.collections);
      if (result.collections.length === 0) {
        toast.warning("The source returned no lists of records.");
        return;
      }
      // One list needs no choosing, so select it and go straight to the fields.
      const only = result.collections.length === 1 ? result.collections[0]! : null;
      if (only) update({ recordsPath: only.path });
      toast.success(
        only
          ? "Source reached — choose the display and key fields."
          : `Source reached — ${result.collections.length} lists found. Choose one.`,
      );
    },
    onError: (error) => toast.error(error.message ?? "Could not reach the source"),
  });

  const saveMutation = trpc.lookupSource.create.useMutation({
    onSuccess: async () => {
      toast.success("Lookup source saved");
      await closeEditor();
    },
    onError: (error) => toast.error(error.message ?? "Could not save the source"),
  });

  const updateMutation = trpc.lookupSource.update.useMutation({
    onSuccess: async () => {
      toast.success("Lookup source updated");
      await closeEditor();
    },
    onError: (error) => toast.error(error.message ?? "Could not save the source"),
  });

  const deleteMutation = trpc.lookupSource.delete.useMutation({
    onSuccess: async () => {
      toast.success("Lookup source deleted");
      await utils.lookupSource.list.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Could not delete the source"),
  });

  const update = (patch: Partial<LookupSourceDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const handleSave = () => {
    const blocker = draftSaveBlocker(draft);
    if (blocker) {
      toast.error(blocker);
      return;
    }
    if (draft.id) {
      updateMutation.mutate({ id: draft.id, source: draftToInput(draft) });
      return;
    }
    saveMutation.mutate(draftToInput(draft));
  };

  const fields = fieldsForCollection(collections, draft.recordsPath);
  const rows = previewRows(
    sampleForCollection(collections, draft.recordsPath),
    draft.displayField,
    draft.keyField,
  );
  const sources = sourcesQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Lookup Sources</CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setDraft(emptyDraft());
            setCollections([]);
            setOpen(true);
          }}
        >
          Add source
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          Register a named list once, then reference it from any template with{" "}
          <code className="font-mono text-xs">(options-source: name)</code>. Operators pick from
          live values, and the chosen code is stored alongside the label for reporting.
        </p>

        {sourcesQuery.isLoading ? <p className="text-muted-foreground">Loading…</p> : null}

        {!sourcesQuery.isLoading && sources.length === 0 ? (
          <p className="text-muted-foreground">No lookup sources yet.</p>
        ) : null}

        {sources.map((source) => (
          <div key={source.id} className="flex items-center justify-between gap-2 border-t pt-2">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {source.label} <span className="font-mono text-xs text-muted-foreground">({source.name})</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {KIND_LABELS[source.kind]} · {source.displayField}
                {source.keyField ? ` / ${source.keyField}` : " (no key)"}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const config = source.config as Record<string, string | undefined>;
                  setDraft({
                    id: source.id,
                    name: source.name,
                    label: source.label,
                    kind: source.kind,
                    url: config.url ?? "",
                    searchParam: config.searchParam ?? "",
                    recordsPath: config.recordsPath ?? "",
                    directoryQuery: config.query ?? "",
                    credential: "",
                    credentialSet: source.credentialSet,
                    displayField: source.displayField,
                    keyField: source.keyField ?? "",
                    cacheTtlSeconds: source.cacheTtlSeconds,
                  });
                  // Re-Test to repopulate the lists: the saved fields are shown
                  // as-is until then rather than guessed at.
                  setCollections([
                    {
                      path: config.recordsPath ?? "",
                      count: 0,
                      fields: [source.displayField, ...(source.keyField ? [source.keyField] : [])],
                      sample: [],
                    },
                  ]);
                  setOpen(true);
                }}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => deleteMutation.mutate({ id: source.id })}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit lookup source" : "Add lookup source"}</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
            <div className="space-y-1">
              <Label htmlFor="lookup-name">Name</Label>
              <Input
                id="lookup-name"
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                placeholder="departments"
              />
              <p className="text-xs text-muted-foreground">
                What template authors write in the tag. Lowercase, no spaces.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="lookup-label">Label</Label>
              <Input
                id="lookup-label"
                value={draft.label}
                onChange={(event) => update({ label: event.target.value })}
                placeholder="Departments"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="lookup-kind">Kind</Label>
              <select
                id="lookup-kind"
                value={draft.kind}
                onChange={(event) => update({ kind: event.target.value as LookupSourceKind })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="directory">People directory</option>
                <option value="managed">Managed list</option>
                <option value="api">API endpoint</option>
              </select>
            </div>

            {draft.kind === "api" ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="lookup-url">URL</Label>
                  <Input
                    id="lookup-url"
                    value={draft.url}
                    onChange={(event) => update({ url: event.target.value })}
                    placeholder="https://directory.example.gov/departments"
                  />
                  <p className="text-xs text-muted-foreground">
                    HTTPS only, and it must be reachable from outside your network.
                  </p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lookup-search-param">Search parameter</Label>
                  <Input
                    id="lookup-search-param"
                    value={draft.searchParam}
                    onChange={(event) => update({ searchParam: event.target.value })}
                    placeholder="q"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lookup-credential">Credential</Label>
                  <Input
                    id="lookup-credential"
                    type="password"
                    autoComplete="off"
                    value={draft.credential}
                    onChange={(event) => update({ credential: event.target.value })}
                    placeholder={draft.credentialSet ? "•••• stored" : "Bearer …"}
                  />
                  <p className="text-xs text-muted-foreground">
                    Sent as the Authorization header and encrypted at rest.{" "}
                    {draft.credentialSet ? "Leave blank to keep the current credential." : null}
                  </p>
                </div>
              </>
            ) : null}

            {draft.kind === "directory" ? (
              <div className="space-y-1">
                <Label htmlFor="lookup-directory-query">Scope (optional)</Label>
                <Input
                  id="lookup-directory-query"
                  value={draft.directoryQuery}
                  onChange={(event) => update({ directoryQuery: event.target.value })}
                  placeholder="finance"
                />
              </div>
            ) : null}

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Test</p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testMutation.isPending}
                  onClick={() =>
                    testMutation.mutate({
                      kind: draft.kind,
                      config: draftToConfig(draft),
                      ...(draft.credential ? { credential: draft.credential } : {}),
                      ...(draft.id ? { sourceId: draft.id } : {}),
                      ...(draft.recordsPath ? { recordsPath: draft.recordsPath } : {}),
                      ...(draft.displayField.trim() ? { displayField: draft.displayField.trim() } : {}),
                      ...(draft.keyField.trim() ? { keyField: draft.keyField.trim() } : {}),
                    })
                  }
                >
                  {testMutation.isPending ? "Testing…" : "Test source"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Fetches a sample so you can choose which field is shown to operators and which
                code is stored for reporting.
              </p>

              {collections.length > 0 ? (
                <div className="space-y-1">
                  <Label htmlFor="lookup-records">Records</Label>
                  <select
                    id="lookup-records"
                    value={draft.recordsPath}
                    onChange={(event) =>
                      update({ recordsPath: event.target.value, displayField: "", keyField: "" })
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Choose a list</option>
                    {collections.map((collection) => (
                      <option key={collection.path} value={collection.path}>
                        {collectionLabel(collection)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    The lists found in the response. Choosing one sets which fields you can pick
                    from.
                  </p>
                </div>
              ) : null}

              <div className="space-y-1">
                <Label htmlFor="lookup-display-field">Display field</Label>
                <select
                  id="lookup-display-field"
                  value={draft.displayField}
                  onChange={(event) => update({ displayField: event.target.value })}
                  disabled={fields.length === 0}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">
                    {fields.length === 0 ? "Test the source and choose a list first" : "Choose a field"}
                  </option>
                  {fields.map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="lookup-key-field">Key field (optional)</Label>
                <select
                  id="lookup-key-field"
                  value={draft.keyField}
                  onChange={(event) => update({ keyField: event.target.value })}
                  disabled={fields.length === 0}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">No key</option>
                  {fields.map((field) => (
                    <option key={field} value={field}>
                      {field}
                    </option>
                  ))}
                </select>
              </div>

              {rows.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Sample</p>
                  <ul className="space-y-0.5 font-mono text-xs">
                    {rows.map((row) => (
                      <li key={row}>{row}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saveMutation.isPending || updateMutation.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
