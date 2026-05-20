"use client";

import Link from "next/link";
import type { Flow, Session, User } from "@rbrasier/domain";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { TableSkeletonRows } from "@/components/skeleton/card-skeleton";
import { trpc } from "@/trpc/client";

const statusVariant = (status: string) => {
  if (status === "active") return "default";
  if (status === "complete") return "secondary";
  return "outline";
};

const formatDate = (date: Date) => new Date(date).toLocaleDateString();

export default function AdminSessionsPage() {
  const sessionsQuery = trpc.session.listAll.useQuery();
  const usersQuery = trpc.user.list.useQuery({});
  const flowsQuery = trpc.flow.list.useQuery();

  const sessions: Session[] = sessionsQuery.data ?? [];
  const users: User[] = usersQuery.data ?? [];
  const flows: Flow[] = flowsQuery.data ?? [];

  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  const flowById = Object.fromEntries(flows.map((f) => [f.id, f]));

  const getInitials = (user: User | undefined): string => {
    if (!user) return "?";
    const name = user.name ?? user.email ?? "?";
    return name.slice(0, 2).toUpperCase();
  };

  const getDisplayName = (user: User | undefined): string => {
    if (!user) return "Unknown";
    return user.name ?? user.email ?? "Unknown";
  };

  return (
    <div className="h-full overflow-auto">
    <div className="container py-8">
    <Card>
      <CardHeader>
        <CardTitle>All Sessions</CardTitle>
      </CardHeader>
      <CardContent>
        {sessionsQuery.isLoading ? (
          <TableSkeletonRows count={4} />
        ) : sessions.length === 0 ? (
          <EmptyState
            icon="📋"
            heading="No sessions yet"
            body="Sessions will appear here once users start chats."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Flow</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => {
                const user = userById[session.userId];
                const flow = flowById[session.flowId];
                const title = session.title ?? flow?.name ?? "Untitled";

                return (
                  <TableRow key={session.id}>
                    <TableCell className="font-medium max-w-[180px] truncate">
                      {title}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="flex items-center gap-1">
                        {flow?.icon && <span>{flow.icon}</span>}
                        <span className="truncate max-w-[120px]">{flow?.name ?? "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-medium text-indigo-700">
                          {getInitials(user)}
                        </span>
                        <span className="text-sm truncate max-w-[120px]">{getDisplayName(user)}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(session.status)} className="capitalize text-xs">
                        {session.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(session.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDate(session.updatedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/chats/${session.id}`}
                        className="text-sm text-indigo-600 hover:underline"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
    </div>
    </div>
  );
}
