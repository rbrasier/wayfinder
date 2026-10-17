"use client";

import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  VERBATIM_SCOPE_NOTE,
  verbatimBadge,
  verbatimConfirmPrompt,
  verbatimFailureNote,
} from "@/components/admin/verbatim-toggle-model";
import {
  CLASSIFICATION_OPTIONS,
  classificationBadge,
  credentialSummary,
  parseCustomHeaders,
  secondsToTimeoutMs,
  timeoutMsToSeconds,
} from "@/components/admin/mcp-server-form-model";
import { McpToolsPanel } from "@/components/admin/mcp-tools-panel";
import { trpc } from "@/trpc/client";

type Classification = (typeof CLASSIFICATION_OPTIONS)[number]["value"];

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs";

// Write-only credential entry for an existing server: a value typed here replaces
// the saved one, and the saved values are never shown back.
function CredentialsEditor({
  serverId,
  hasCredential,
  onDone,
}: {
  serverId: string;
  hasCredential: boolean;
  onDone: () => void;
}) {
  const [token, setToken] = useState("");
  const [headers, setHeaders] = useState("");
  const [error, setError] = useState<string | null>(null);
  const update = trpc.mcpServer.update.useMutation({ onSuccess: onDone, onError: (cause) => setError(cause.message) });

  const save = () => {
    const parsed = parseCustomHeaders(headers);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    update.mutate({
      id: serverId,
      ...(token.trim() ? { bearerToken: token } : {}),
      ...(headers.trim() ? { customHeaders: parsed.headers } : {}),
    });
  };

  return (
    <div className="space-y-2 py-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`token-${serverId}`} className="text-xs">
            New bearer token
          </Label>
          <Input
            id={`token-${serverId}`}
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`headers-${serverId}`} className="text-xs">
            Replace custom headers (one &quot;Name: value&quot; per line)
          </Label>
          <Textarea
            id={`headers-${serverId}`}
            rows={2}
            value={headers}
            onChange={(event) => setHeaders(event.target.value)}
          />
        </div>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="space-x-2">
        <Button size="sm" onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save credentials"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => update.mutate({ id: serverId, bearerToken: null, customHeaders: null })}
          disabled={update.isPending || !hasCredential}
        >
          Clear saved credentials
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={update.isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function AdminMcpServersContent() {
  const utils = trpc.useUtils();
  const serversQuery = trpc.mcpServer.list.useQuery({ includeDisabled: true });

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"sse" | "streamable-http">("sse");
  const [dataClassification, setDataClassification] = useState<Classification>("internal");
  const [verbatimOnly, setVerbatimOnly] = useState(false);
  const [timeoutSeconds, setTimeoutSeconds] = useState("30");
  const [bearerToken, setBearerToken] = useState("");
  const [customHeaders, setCustomHeaders] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<{ id: string; panel: "tools" | "credentials" } | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // A governance guarantee must never change by a stray click, so the toggle
  // stages the intended value and a second, explicit action commits it.
  const [confirmVerbatim, setConfirmVerbatim] = useState<{
    id: string;
    label: string;
    next: boolean;
  } | null>(null);
  // Reported beside the toggle rather than in the form's shared error line at the
  // top of the page, which the administrator is not looking at when they press it.
  const [verbatimError, setVerbatimError] = useState<string | null>(null);

  const invalidate = () => void utils.mcpServer.list.invalidate();

  const register = trpc.mcpServer.register.useMutation({
    onSuccess: () => {
      setLabel("");
      setUrl("");
      setTransport("sse");
      setDataClassification("internal");
      setVerbatimOnly(false);
      setTimeoutSeconds("30");
      setBearerToken("");
      setCustomHeaders("");
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(cause.message),
  });
  const update = trpc.mcpServer.update.useMutation({
    onSuccess: () => {
      setConfirmVerbatim(null);
      setVerbatimError(null);
      invalidate();
    },
    // The confirm panel stays open so the change can be retried where it was
    // started, and the badge above it still shows the setting as it really is.
    onError: (cause) => setVerbatimError(verbatimFailureNote(cause.message)),
  });
  // Classification and timeout changes report beside the row they were made on.
  const updateSettings = trpc.mcpServer.update.useMutation({
    onSuccess: (_data, variables) => {
      setRowError((current) => ({ ...current, [variables.id]: "" }));
      invalidate();
    },
    onError: (cause, variables) => setRowError((current) => ({ ...current, [variables.id]: cause.message })),
  });
  const disable = trpc.mcpServer.disable.useMutation({ onSuccess: invalidate });
  const enable = trpc.mcpServer.enable.useMutation({ onSuccess: invalidate });
  const remove = trpc.mcpServer.delete.useMutation({
    onSuccess: () => {
      setConfirmDeleteId(null);
      invalidate();
    },
    onError: (cause) => setError(cause.message),
  });
  const test = trpc.mcpServer.test.useMutation({
    onSuccess: (data, variables) =>
      setTestResult((prev) => ({
        ...prev,
        [variables.id]: `OK — ${data.toolCount} tool(s)`,
      })),
    onError: (cause, variables) =>
      setTestResult((prev) => ({ ...prev, [variables.id]: `Failed — ${cause.message}` })),
  });

  const submit = () => {
    if (!label.trim() || !url.trim()) return;
    const headers = parseCustomHeaders(customHeaders);
    if (headers.error) {
      setError(headers.error);
      return;
    }
    register.mutate({
      label,
      url,
      transport,
      dataClassification,
      verbatimOnly,
      callTimeoutMs: secondsToTimeoutMs(timeoutSeconds),
      bearerToken: bearerToken.trim() ? bearerToken : null,
      customHeaders: Object.keys(headers.headers).length > 0 ? headers.headers : null,
    });
  };

  const togglePanel = (id: string, panel: "tools" | "credentials") =>
    setOpenPanel((current) => (current?.id === id && current.panel === panel ? null : { id, panel }));

  return (
    <div className="h-full overflow-auto">
      <div className="container py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Register an MCP server</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Register a remote Model Context Protocol server. Flow authors can then
              use its tools without seeing credentials. The bearer token and custom
              headers are stored encrypted and are never shown again after saving.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label htmlFor="mcp-label">Label</Label>
                <Input
                  id="mcp-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="GitHub"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-transport">Transport</Label>
                <select
                  id="mcp-transport"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                  value={transport}
                  onChange={(event) => setTransport(event.target.value as "sse" | "streamable-http")}
                >
                  <option value="sse">SSE</option>
                  <option value="streamable-http">Streamable HTTP</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-url">URL</Label>
                <Input
                  id="mcp-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://mcp.example.com/sse"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-timeout">Call timeout (seconds)</Label>
                <Input
                  id="mcp-timeout"
                  inputMode="numeric"
                  value={timeoutSeconds}
                  onChange={(event) => setTimeoutSeconds(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">Per request, 1–120. Public-data sources often need 30+.</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mcp-token">Bearer token (optional)</Label>
                <Input
                  id="mcp-token"
                  type="password"
                  autoComplete="off"
                  value={bearerToken}
                  onChange={(event) => setBearerToken(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-headers">Custom headers (optional, one &quot;Name: value&quot; per line)</Label>
                <Textarea
                  id="mcp-headers"
                  rows={2}
                  value={customHeaders}
                  onChange={(event) => setCustomHeaders(event.target.value)}
                  placeholder="X-Api-Key: …"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mcp-classification">What does this server do with data?</Label>
              <select
                id="mcp-classification"
                className={SELECT_CLASS}
                value={dataClassification}
                onChange={(event) => setDataClassification(event.target.value as Classification)}
              >
                {CLASSIFICATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {CLASSIFICATION_OPTIONS.find((option) => option.value === dataClassification)?.description}
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor="mcp-verbatim" className="flex items-center gap-2 text-sm font-medium">
                <input
                  id="mcp-verbatim"
                  type="checkbox"
                  checked={verbatimOnly}
                  onChange={(event) => setVerbatimOnly(event.target.checked)}
                />
                Use this connection's results verbatim
              </label>
              <p className="pl-6 text-xs text-muted-foreground">{VERBATIM_SCOPE_NOTE}</p>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button onClick={submit} disabled={register.isPending || !label.trim() || !url.trim()}>
              {register.isPending ? "Registering…" : "Register server"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Registered servers</CardTitle>
          </CardHeader>
          <CardContent>
            {serversQuery.isPending ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : serversQuery.data && serversQuery.data.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Label</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Transport</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Timeout</TableHead>
                    <TableHead>Handling</TableHead>
                    <TableHead>Credential</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {serversQuery.data.map((server) => (
                    <Fragment key={server.id}>
                    <TableRow>
                      <TableCell className="font-medium">{server.label}</TableCell>
                      <TableCell className="font-mono text-xs">{server.url}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {server.transport === "streamable-http" ? "Streamable HTTP" : "SSE"}
                      </TableCell>
                      <TableCell className="space-y-1">
                        <Badge variant={classificationBadge(server.dataClassification).usableInFlows ? "default" : "outline"}>
                          {classificationBadge(server.dataClassification).label}
                        </Badge>
                        <select
                          aria-label={`Classification for ${server.label}`}
                          className={SELECT_CLASS}
                          value={server.dataClassification}
                          disabled={updateSettings.isPending}
                          onChange={(event) =>
                            updateSettings.mutate({ id: server.id, dataClassification: event.target.value as Classification })
                          }
                        >
                          {CLASSIFICATION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {rowError[server.id] ? <p className="text-xs text-destructive">{rowError[server.id]}</p> : null}
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Timeout in seconds for ${server.label}`}
                          className="w-20"
                          inputMode="numeric"
                          defaultValue={timeoutMsToSeconds(server.callTimeoutMs)}
                          onBlur={(event) => {
                            const callTimeoutMs = secondsToTimeoutMs(event.target.value);
                            if (callTimeoutMs !== undefined && callTimeoutMs !== server.callTimeoutMs) {
                              updateSettings.mutate({ id: server.id, callTimeoutMs });
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell className="space-y-1">
                        {verbatimBadge(server.verbatimOnly) ? (
                          <Badge variant="default">{verbatimBadge(server.verbatimOnly)}</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Standard</span>
                        )}
                        {confirmVerbatim?.id === server.id ? (
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">
                              {verbatimConfirmPrompt(confirmVerbatim.label, confirmVerbatim.next)}
                            </p>
                            <div className="space-x-2">
                              <Button
                                size="sm"
                                onClick={() => {
                                  setVerbatimError(null);
                                  update.mutate({ id: server.id, verbatimOnly: confirmVerbatim.next });
                                }}
                                disabled={update.isPending}
                              >
                                {update.isPending ? "Saving…" : "Confirm"}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setConfirmVerbatim(null);
                                  setVerbatimError(null);
                                }}
                                disabled={update.isPending}
                              >
                                Cancel
                              </Button>
                            </div>
                            {verbatimError ? (
                              <p className="text-xs text-destructive">{verbatimError}</p>
                            ) : null}
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setVerbatimError(null);
                              setConfirmVerbatim({
                                id: server.id,
                                label: server.label,
                                next: !server.verbatimOnly,
                              });
                            }}
                          >
                            {server.verbatimOnly ? "Allow rewriting" : "Require verbatim"}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {credentialSummary(server)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={server.status === "active" ? "default" : "outline"}>
                          {server.status}
                        </Badge>
                        {testResult[server.id] ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {testResult[server.id]}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right [&>*+*]:ml-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => test.mutate({ id: server.id })}
                          disabled={test.isPending}
                        >
                          Test
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => togglePanel(server.id, "tools")}>
                          Tools
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => togglePanel(server.id, "credentials")}>
                          Credentials
                        </Button>
                        {server.status === "active" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => disable.mutate({ id: server.id })}
                            disabled={disable.isPending}
                          >
                            Disable
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => enable.mutate({ id: server.id })}
                            disabled={enable.isPending}
                          >
                            Enable
                          </Button>
                        )}
                        {confirmDeleteId === server.id ? (
                          <>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => remove.mutate({ id: server.id })}
                              disabled={remove.isPending}
                            >
                              {remove.isPending ? "Deleting…" : "Confirm"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={remove.isPending}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmDeleteId(server.id)}
                          >
                            Delete
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                    {openPanel?.id === server.id ? (
                      <TableRow>
                        <TableCell colSpan={9}>
                          {openPanel.panel === "tools" ? (
                            <McpToolsPanel serverId={server.id} />
                          ) : (
                            <CredentialsEditor
                              serverId={server.id}
                              hasCredential={server.hasCredential || server.customHeaderNames.length > 0}
                              onDone={() => {
                                setOpenPanel(null);
                                invalidate();
                              }}
                            />
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">
                No MCP servers registered yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
