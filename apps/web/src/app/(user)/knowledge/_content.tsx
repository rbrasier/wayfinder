"use client";

import type { ChunkStatus, CuratedChunk } from "@rbrasier/domain";
import { useSearchParams } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";

type SearchMode = "semantic" | "exact";

// Bold the lexemes the search engine matched so an SME can confirm an exact term
// (SKU, code) was actually found (ADR-029 highlighting).
function highlight(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0) return text;
  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "gi");
  return text.split(pattern).map((part, index) =>
    terms.some((term) => term.toLowerCase() === part.toLowerCase()) ? (
      <mark key={index} className="bg-[#fce7a3] text-[#1a1814]">
        {part}
      </mark>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const statusVariant = (status: ChunkStatus): "default" | "secondary" | "outline" =>
  status === "active" ? "default" : status === "archived" ? "secondary" : "outline";

export function KnowledgeContent() {
  const utils = trpc.useUtils();
  const flowsQuery = trpc.session.listPublishedFlows.useQuery();
  const searchParams = useSearchParams();
  const initialFlowId = searchParams.get("flowId") ?? "";

  const [flowId, setFlowId] = useState<string>(initialFlowId);
  const [statusFilter, setStatusFilter] = useState<ChunkStatus | "">("");
  const [searchText, setSearchText] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("semantic");
  const [activeSearch, setActiveSearch] = useState<{ text: string; mode: SearchMode } | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerChunkId, setDrawerChunkId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [tagOpen, setTagOpen] = useState(false);
  const [tagValue, setTagValue] = useState("");
  const [showSource, setShowSource] = useState(false);

  const isSearching = activeSearch !== null && flowId !== "";

  const listQuery = trpc.knowledge.list.useQuery(
    {
      flowId: flowId || null,
      status: statusFilter || null,
      tag: null,
      limit: 100,
      offset: 0,
    },
    { enabled: flowId !== "" && !isSearching },
  );

  const searchQuery = trpc.knowledge.search.useQuery(
    {
      text: activeSearch?.text ?? "",
      mode: activeSearch?.mode ?? "semantic",
      scope: { flowId },
    },
    { enabled: isSearching },
  );

  const feedbackQuery = trpc.feedback.list.useQuery({ status: "pending", limit: 50, offset: 0 });

  const rows: { chunk: CuratedChunk; matched: string[] }[] = useMemo(() => {
    if (isSearching) {
      return (searchQuery.data ?? []).map((hit) => ({ chunk: hit.chunk, matched: hit.matchedTerms }));
    }
    return (listQuery.data ?? []).map((chunk) => ({ chunk, matched: [] }));
  }, [isSearching, searchQuery.data, listQuery.data]);

  const drawerChunk = rows.find((row) => row.chunk.id === drawerChunkId)?.chunk ?? null;

  const versionsQuery = trpc.knowledge.versions.useQuery(
    { chunkId: drawerChunkId ?? "" },
    { enabled: drawerChunkId !== null },
  );

  const invalidateRows = (): void => {
    void utils.knowledge.list.invalidate();
    void utils.knowledge.search.invalidate();
  };

  const editMutation = trpc.knowledge.edit.useMutation({
    onSuccess: () => {
      invalidateRows();
      void utils.knowledge.versions.invalidate();
    },
  });
  const statusMutation = trpc.knowledge.setStatus.useMutation({
    onSuccess: () => {
      invalidateRows();
      setSelectedIds(new Set());
    },
  });
  const tagMutation = trpc.knowledge.tag.useMutation({
    onSuccess: () => {
      invalidateRows();
      setSelectedIds(new Set());
      setTagOpen(false);
      setTagValue("");
    },
  });
  const revertMutation = trpc.knowledge.revert.useMutation({
    onSuccess: () => {
      invalidateRows();
      void utils.knowledge.versions.invalidate();
    },
  });
  const triageMutation = trpc.feedback.triage.useMutation({
    onSuccess: () => void utils.feedback.list.invalidate(),
  });

  const toggleRow = (id: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openDrawer = (chunk: CuratedChunk): void => {
    setDrawerChunkId(chunk.id);
    setEditText(chunk.chunkText);
    setShowSource(false);
  };

  const runSearch = (): void => {
    const text = searchText.trim();
    setActiveSearch(text.length === 0 ? null : { text, mode: searchMode });
  };

  const selectedList = [...selectedIds];

  return (
    <div className="h-full overflow-auto">
      <div className="container space-y-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Knowledge base</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="flow">Flow</Label>
                <select
                  id="flow"
                  className="h-9 w-64 rounded-md border border-[#dedad2] bg-white px-3 text-sm"
                  value={flowId}
                  onChange={(event) => {
                    setFlowId(event.target.value);
                    setActiveSearch(null);
                    setSelectedIds(new Set());
                  }}
                >
                  <option value="">Select a flow…</option>
                  {(flowsQuery.data ?? []).map((flow) => (
                    <option key={flow.id} value={flow.id}>
                      {flow.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="status">Status</Label>
                <select
                  id="status"
                  className="h-9 w-40 rounded-md border border-[#dedad2] bg-white px-3 text-sm"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as ChunkStatus | "")}
                  disabled={isSearching}
                >
                  <option value="">All statuses</option>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              </div>

              <div className="flex-1 space-y-1">
                <Label htmlFor="search">Search</Label>
                <div className="flex gap-2">
                  <Input
                    id="search"
                    placeholder={
                      searchMode === "exact"
                        ? "Exact term, e.g. INV-2024-001"
                        : "Search by meaning…"
                    }
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && runSearch()}
                    disabled={flowId === ""}
                  />
                  <button
                    type="button"
                    onClick={() => setSearchMode((mode) => (mode === "semantic" ? "exact" : "semantic"))}
                    className="h-9 shrink-0 rounded-md border border-[#dedad2] px-3 text-xs font-medium text-[#5a554d] hover:bg-[#f0eee9]"
                    title="Toggle exact / semantic"
                  >
                    {searchMode === "exact" ? "Exact match" : "Semantic"}
                  </button>
                  <Button type="button" onClick={runSearch} disabled={flowId === ""}>
                    Search
                  </Button>
                  {isSearching && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setActiveSearch(null);
                        setSearchText("");
                      }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {selectedList.length > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-[#dedad2] bg-[#f7f6f3] px-3 py-2">
                <span className="text-xs text-[#5a554d]">{selectedList.length} selected</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => statusMutation.mutate({ chunkIds: selectedList, status: "archived" })}
                >
                  Archive
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => statusMutation.mutate({ chunkIds: selectedList, status: "active" })}
                >
                  Restore
                </Button>
                <Button size="sm" variant="outline" onClick={() => setTagOpen(true)}>
                  Add tag
                </Button>
              </div>
            )}

            {flowId === "" ? (
              <p className="text-sm text-muted-foreground">Select a flow to view its knowledge.</p>
            ) : listQuery.isLoading || searchQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matching content.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Content</TableHead>
                    <TableHead className="w-40">Source</TableHead>
                    <TableHead className="w-24">Status</TableHead>
                    <TableHead className="w-40">Tags</TableHead>
                    <TableHead className="w-20 text-right">Used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ chunk, matched }) => (
                    <TableRow key={chunk.id} className="cursor-pointer">
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(chunk.id)}
                          onChange={() => toggleRow(chunk.id)}
                          onClick={(event) => event.stopPropagation()}
                        />
                      </TableCell>
                      <TableCell onClick={() => openDrawer(chunk)}>
                        <span className="line-clamp-2 text-xs text-[#1a1814]">
                          {highlight(chunk.chunkText, matched)}
                        </span>
                      </TableCell>
                      <TableCell
                        className="truncate font-mono text-[11px] text-[#6d6a65]"
                        onClick={() => openDrawer(chunk)}
                      >
                        {chunk.filename}
                      </TableCell>
                      <TableCell onClick={() => openDrawer(chunk)}>
                        <Badge variant={statusVariant(chunk.status)}>{chunk.status}</Badge>
                      </TableCell>
                      <TableCell onClick={() => openDrawer(chunk)}>
                        <span className="text-[11px] text-[#5a554d]">
                          {chunk.tags.length > 0 ? chunk.tags.join(", ") : "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-xs text-[#5a554d]" onClick={() => openDrawer(chunk)}>
                        {chunk.retrievalCount}×
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pending corrections</CardTitle>
          </CardHeader>
          <CardContent>
            {feedbackQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (feedbackQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No corrections waiting for review.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Flagged answer</TableHead>
                    <TableHead>Suggested fix</TableHead>
                    <TableHead className="w-28">Reason</TableHead>
                    <TableHead className="w-40 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(feedbackQuery.data ?? []).map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs text-[#6d6a65]">
                        <span className="line-clamp-2">{item.flaggedAnswer}</span>
                      </TableCell>
                      <TableCell className="text-xs text-[#1a1814]">
                        <span className="line-clamp-2">{item.correctedText}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{item.reason}</Badge>
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => triageMutation.mutate({ feedbackId: item.id, status: "accepted" })}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => triageMutation.mutate({ feedbackId: item.id, status: "dismissed" })}
                        >
                          Dismiss
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {drawerChunk && (
        <aside className="fixed right-0 top-0 z-50 flex h-screen w-[440px] flex-col border-l border-[#dedad2] bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-[#dedad2] px-4 py-3">
            <h2 className="text-sm font-semibold">Edit content</h2>
            <button
              type="button"
              onClick={() => setDrawerChunkId(null)}
              className="text-[#6d6a65] hover:text-[#1a1814]"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
            <Textarea rows={8} value={editText} onChange={(event) => setEditText(event.target.value)} />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={editText.trim() === drawerChunk.chunkText || editMutation.isPending}
                onClick={() =>
                  editMutation.mutate({ chunkId: drawerChunk.id, newText: editText, reason: "sme edit" })
                }
              >
                {editMutation.isPending ? "Saving…" : "Save & re-evaluate"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowSource((value) => !value)}>
                View in source
              </Button>
            </div>

            {showSource && (
              <div className="rounded-md border border-[#dedad2] bg-[#f7f6f3] p-3 text-xs text-[#5a554d]">
                <p className="mb-1 font-mono text-[11px] text-[#6d6a65]">
                  {drawerChunk.filename} · segment #{drawerChunk.chunkIndex}
                </p>
                <p className="whitespace-pre-wrap">{drawerChunk.chunkText}</p>
              </div>
            )}

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6d6a65]">
                Version history
              </h3>
              {(versionsQuery.data ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No edits yet.</p>
              ) : (
                <ul className="space-y-2">
                  {(versionsQuery.data ?? []).map((version) => (
                    <li key={version.id} className="rounded-md border border-[#dedad2] p-2">
                      <p className="mb-1 line-clamp-2 text-xs text-[#5a554d]">{version.chunkText}</p>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-[#6d6a65]">
                          {new Date(version.createdAt).toLocaleString()}
                          {version.reason ? ` · ${version.reason}` : ""}
                        </span>
                        <button
                          type="button"
                          className="text-[10px] font-medium text-[#3a5fd9] hover:underline"
                          onClick={() =>
                            revertMutation.mutate({ chunkId: drawerChunk.id, versionId: version.id })
                          }
                        >
                          Revert to this
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>
      )}

      <Dialog open={tagOpen} onOpenChange={(open) => !open && setTagOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add tag to {selectedList.length} items</DialogTitle>
            <DialogCloseButton />
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              tagMutation.mutate({ chunkIds: selectedList, tag: tagValue });
            }}
          >
            <DialogBody>
              <div className="space-y-2">
                <Label htmlFor="tag">Tag</Label>
                <Input id="tag" required value={tagValue} onChange={(event) => setTagValue(event.target.value)} />
              </div>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setTagOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={tagMutation.isPending}>
                Add tag
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
