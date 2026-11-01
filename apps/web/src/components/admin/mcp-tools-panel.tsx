"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";
import {
  toolSettingsFromForm,
  toolSettingsToForm,
  type McpToolSettingsForm,
  type McpToolSettingsValue,
} from "./mcp-server-form-model";

interface CachedTool extends McpToolSettingsValue {
  name: string;
  title: string | null;
  description: string | null;
  lastSyncedAt: Date | string;
}

const FIELD_GROUPS: { title: string; hint: string; fields: { key: keyof McpToolSettingsForm; label: string; placeholder: string }[] }[] = [
  {
    title: "Pagination",
    hint: "Leave the cursor argument blank to fetch one page only.",
    fields: [
      { key: "cursorArgument", label: "Cursor argument", placeholder: "cursor" },
      { key: "nextCursorPath", label: "Next-cursor path", placeholder: "next_cursor" },
      { key: "itemsPath", label: "Items path", placeholder: "items" },
      { key: "maxPages", label: "Page limit (1–20)", placeholder: "5" },
    ],
  },
  {
    title: "Source status",
    hint: "Leave the status path blank to skip. Unmapped values read as ok.",
    fields: [
      { key: "statusPath", label: "Status path", placeholder: "status" },
      { key: "caveatsPath", label: "Caveats path", placeholder: "caveats" },
    ],
  },
  {
    title: "Citations",
    hint: "Leave the records path blank to cite only the links the server returns itself.",
    fields: [
      { key: "recordsPath", label: "Records path", placeholder: "items" },
      { key: "locatorField", label: "Locator field", placeholder: "id" },
      { key: "titleField", label: "Title field", placeholder: "title" },
      { key: "urlField", label: "URL field", placeholder: "url" },
      { key: "timestampField", label: "Timestamp field", placeholder: "published_at" },
    ],
  },
];

function ToolSettingsEditor({ serverId, tool, onSaved }: { serverId: string; tool: CachedTool; onSaved: () => void }) {
  const [form, setForm] = useState<McpToolSettingsForm>(() => toolSettingsToForm(tool));
  const [error, setError] = useState<string | null>(null);
  const save = trpc.mcpServer.updateToolSettings.useMutation({
    onSuccess: () => {
      setError(null);
      onSaved();
    },
    onError: (cause) => setError(cause.message),
  });

  const submit = () => {
    const parsed = toolSettingsFromForm(form);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    save.mutate({ serverId, toolName: tool.name, settings: parsed.settings });
  };

  return (
    <div className="space-y-3 rounded-md border p-3">
      {FIELD_GROUPS.map((group) => (
        <div key={group.title} className="space-y-1.5">
          <p className="text-sm font-medium">{group.title}</p>
          <p className="text-xs text-muted-foreground">{group.hint}</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {group.fields.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={`${tool.name}-${field.key}`} className="text-xs">
                  {field.label}
                </Label>
                <Input
                  id={`${tool.name}-${field.key}`}
                  value={form[field.key]}
                  placeholder={field.placeholder}
                  onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </div>
            ))}
          </div>
          {group.title === "Source status" ? (
            <div className="space-y-1">
              <Label htmlFor={`${tool.name}-statusMeanings`} className="text-xs">
                Status meanings (one per line: value = ok | no-data | source-unavailable | upstream-gap)
              </Label>
              <Textarea
                id={`${tool.name}-statusMeanings`}
                rows={3}
                value={form.statusMeanings}
                placeholder={"no_data = no-data\nsource_unavailable = source-unavailable"}
                onChange={(event) => setForm((current) => ({ ...current, statusMeanings: event.target.value }))}
              />
            </div>
          ) : null}
        </div>
      ))}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button size="sm" onClick={submit} disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}

// The cached tools of one server, with each tool's pagination, status mapping
// and citation settings (ADR-062 §5).
export function McpToolsPanel({ serverId }: { serverId: string }) {
  const utils = trpc.useUtils();
  const toolsQuery = trpc.mcpServer.listTools.useQuery({ serverId });
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => void utils.mcpServer.listTools.invalidate({ serverId });
  const refresh = trpc.mcpServer.refreshTools.useMutation({
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(cause.message),
  });

  const tools = (toolsQuery.data ?? []) as CachedTool[];
  return (
    <div className="space-y-2 py-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => refresh.mutate({ serverId })} disabled={refresh.isPending}>
          {refresh.isPending ? "Refreshing…" : "Refresh tools"}
        </Button>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </div>
      {toolsQuery.isPending ? (
        <p className="text-xs text-muted-foreground">Loading tools…</p>
      ) : tools.length === 0 ? (
        <p className="text-xs text-muted-foreground">No tools cached yet — refresh to list them.</p>
      ) : (
        <ul className="space-y-2">
          {tools.map((tool) => (
            <li key={tool.name} className="space-y-1">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium">{tool.title ?? tool.name}</span>
                <code className="text-xs text-muted-foreground">{tool.name}</code>
                <span className="text-xs text-muted-foreground">
                  {[tool.pagination && "paginated", tool.status && "status mapped", tool.citation && "cites records"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setOpenTool(openTool === tool.name ? null : tool.name)}
                >
                  {openTool === tool.name ? "Close" : "Settings"}
                </Button>
              </div>
              {openTool === tool.name ? (
                <ToolSettingsEditor serverId={serverId} tool={tool} onSaved={invalidate} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
