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

export function AdminMcpServersContent() {
  const utils = trpc.useUtils();
  const serversQuery = trpc.mcpServer.list.useQuery({ includeDisabled: true });

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<"sse" | "streamable-http">("sse");
  const [communicatesExternally, setCommunicatesExternally] = useState(false);
  const [credentialRef, setCredentialRef] = useState("");
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
      setCredentialRef("");
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
      credentialRef: credentialRef.trim() ? credentialRef.trim() : null,
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
              Register a remote (SSE) Model Context Protocol server. Flow authors
              can then use its tools without seeing credentials. The credential
              reference names an environment variable holding the bearer token —
              the secret itself is never stored here.
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
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
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
                <Label htmlFor="mcp-cred">Credential ref (env var)</Label>
                <Input
                  id="mcp-cred"
                  value={credentialRef}
                  onChange={(event) => setCredentialRef(event.target.value)}
                  placeholder="MCP_CRED_GITHUB_TOKEN"
                />
                <p className="text-xs text-muted-foreground">
                  Must name an environment variable in the <code>MCP_CRED_</code> namespace.
                </p>
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
                Permitted to communicate outside Wayfinder
              </label>
              <p className="pl-6 text-xs text-muted-foreground">
                Leave off for self-contained utilities (spellcheck, calculation) — these are
                usable in flows and governed by document review. Turn on for external
                integrations; those are registered here but not yet selectable in flows.
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
            {serversQuery.isLoading ? (
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
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {server.credentialRef ?? "—"}
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
                      <TableCell className="space-x-2 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => test.mutate({ id: server.id })}
                          disabled={test.isPending}
                        >
                          Test
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
    </div>
  );
}
