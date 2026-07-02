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
  const featureQuery = trpc.featureFlag.isEnabledForMe.useQuery({ key: "mcp" });
  const serversQuery = trpc.mcpServer.list.useQuery({ includeDisabled: true });

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<"context" | "actions">("context");
  const [credentialRef, setCredentialRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const invalidate = () => void utils.mcpServer.list.invalidate();

  const register = trpc.mcpServer.register.useMutation({
    onSuccess: () => {
      setLabel("");
      setUrl("");
      setKind("context");
      setCredentialRef("");
      setError(null);
      invalidate();
    },
    onError: (cause) => setError(cause.message),
  });
  const disable = trpc.mcpServer.disable.useMutation({ onSuccess: invalidate });
  const enable = trpc.mcpServer.enable.useMutation({ onSuccess: invalidate });
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
      kind,
      credentialRef: credentialRef.trim() ? credentialRef.trim() : null,
    });
  };

  if (featureQuery.data === false) {
    return (
      <div className="h-full overflow-auto">
        <div className="container py-8">
          <Card>
            <CardHeader>
              <CardTitle>MCP servers unavailable</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                The MCP feature is turned off for your account. An administrator can
                enable the <span className="font-mono">mcp</span> feature flag to manage
                servers here.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

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
            <div className="grid gap-3 sm:grid-cols-2">
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
                <Label htmlFor="mcp-url">SSE URL</Label>
                <Input
                  id="mcp-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://mcp.example.com/sse"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-kind">Type</Label>
                <select
                  id="mcp-kind"
                  className="flex h-10 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as "context" | "actions")}
                >
                  <option value="context">Context (read-only) — grounds the AI flow-wide</option>
                  <option value="actions">Actions (write) — runs in a confirmed action step</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mcp-cred">Credential ref (env var)</Label>
                <Input
                  id="mcp-cred"
                  value={credentialRef}
                  onChange={(event) => setCredentialRef(event.target.value)}
                  placeholder="MCP_GITHUB_TOKEN"
                />
              </div>
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
                    <TableHead>Type</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Credential</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {serversQuery.data.map((server) => (
                    <TableRow key={server.id}>
                      <TableCell className="font-medium">{server.label}</TableCell>
                      <TableCell>
                        <Badge variant={server.kind === "actions" ? "default" : "outline"}>
                          {server.kind === "actions" ? "Actions" : "Context"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{server.url}</TableCell>
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
