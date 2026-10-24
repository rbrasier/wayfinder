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
import { EditMcpServerDialog, type EditableMcpServer } from "./edit-mcp-server-dialog";
import { credentialSummary } from "./mcp-server-model";

export function AdminMcpServersContent() {
  const utils = trpc.useUtils();
  const serversQuery = trpc.mcpServer.list.useQuery({ includeDisabled: true });

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"sse" | "streamable-http">("sse");
  const [communicatesExternally, setCommunicatesExternally] = useState(false);
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState<EditableMcpServer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const invalidate = () => void utils.mcpServer.list.invalidate();

  const register = trpc.mcpServer.register.useMutation({
    onSuccess: () => {
      setLabel("");
      setUrl("");
      setTransport("sse");
      setCommunicatesExternally(false);
      setToken("");
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(cause.message),
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
    register.mutate({
      label,
      url,
      transport,
      communicatesExternally,
      credential: token.trim() ? token.trim() : null,
    });
  };

  return (
    <div className="h-full overflow-auto">
      <div className="container py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Register an MCP server</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Register a remote Model Context Protocol server. Flow authors can
              then use its tools without seeing credentials. A bearer token is
              stored encrypted and never shown again.
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
                <Label htmlFor="mcp-cred">Bearer token (optional)</Label>
                <Input
                  id="mcp-cred"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">Stored encrypted.</p>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor="mcp-external" className="flex items-center gap-2 text-sm font-medium">
                <input
                  id="mcp-external"
                  type="checkbox"
                  checked={communicatesExternally}
                  onChange={(event) => setCommunicatesExternally(event.target.checked)}
                />
                Sends data outside Wayfinder
              </label>
              <p className="pl-6 text-xs text-muted-foreground">
                Tick for integrations that pass data to another system (ParlView, a ticketing
                tool); leave off for self-contained utilities such as spellcheck. Either way the
                server can be used in AI task and conversational steps — this marks it External
                so flow authors know where their data goes.
              </p>
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
                    <TableHead>Scope</TableHead>
                    <TableHead>Credential</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {serversQuery.data.map((server) => (
                    <TableRow key={server.id}>
                      <TableCell className="font-medium">{server.label}</TableCell>
                      <TableCell className="font-mono text-xs">{server.url}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {server.transport === "streamable-http" ? "Streamable HTTP" : "SSE"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={server.communicatesExternally ? "outline" : "default"}>
                          {server.communicatesExternally ? "External" : "Internal"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {credentialSummary(server).text}
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
                        <Button variant="outline" size="sm" onClick={() => setEditing(server)}>
                          Edit
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
      <EditMcpServerDialog server={editing} onClose={() => setEditing(null)} onSaved={invalidate} />
    </div>
  );
}
