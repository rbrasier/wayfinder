"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { trpc } from "@/trpc/client";
import { McpServerDialog, type McpServerDialogTarget } from "./mcp-server-dialog";
import { credentialSummary } from "./mcp-server-model";

export function AdminMcpServersContent() {
  const utils = trpc.useUtils();
  const serversQuery = trpc.mcpServer.list.useQuery({ includeDisabled: true });

  const [dialog, setDialog] = useState<McpServerDialogTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const invalidate = () => void utils.mcpServer.list.invalidate();

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

  return (
    <div className="h-full overflow-auto">
      <div className="container py-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-muted-foreground">
            Remote Model Context Protocol servers whose tools flow authors can use without seeing
            credentials.
          </p>
          <Button onClick={() => setDialog({ mode: "create" })}>New MCP server</Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

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
                        <Button variant="outline" size="sm" onClick={() => setDialog({ mode: "edit", server })}>
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
      <McpServerDialog target={dialog} onClose={() => setDialog(null)} onSaved={invalidate} />
    </div>
  );
}
