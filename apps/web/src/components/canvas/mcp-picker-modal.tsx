"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { McpServerWithTools } from "@rbrasier/domain";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface McpPickerModalProps {
  open: boolean;
  servers: McpServerWithTools[];
  isToolAllowed: (serverId: string, toolName: string) => boolean;
  toggleAllowedTool: (serverId: string, toolName: string) => void;
  onClose: () => void;
}

// A focused picker for attaching MCP tools to a conversational step, opened from
// the compact button beside the AI instructions. Mirrors the skill picker so the
// two power-user surfaces feel the same and the node config form stays uncluttered.
export function McpPickerModal({
  open,
  servers,
  isToolAllowed,
  toggleAllowedTool,
  onClose,
}: McpPickerModalProps) {
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? servers
        .map((entry) => ({
          ...entry,
          tools: entry.tools.filter((tool) =>
            `${entry.server.label} ${tool.name} ${tool.description ?? ""}`
              .toLowerCase()
              .includes(needle),
          ),
        }))
        .filter((entry) => entry.tools.length > 0)
    : servers;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add MCP tools</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-[12px] text-[#857f76]">
            Let the AI call these tools mid-conversation. Register servers on the MCP Servers page.
          </p>
          {servers.length > 0 && (
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#918d87]"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tools…"
                className="pl-8"
              />
            </div>
          )}
          {servers.length === 0 ? (
            <p className="text-[13px] text-[#857f76]">No MCP servers available.</p>
          ) : filtered.length === 0 ? (
            <p className="text-[13px] text-[#857f76]">No tools match “{query}”.</p>
          ) : (
            <div className="max-h-[46vh] space-y-3 overflow-y-auto rounded-[9px] border border-[#dedad2] p-2.5">
              {filtered.map((entry) => (
                <div key={entry.server.id} className="space-y-1.5">
                  <p className="text-[12px] font-medium text-[#5a5650]">{entry.server.label}</p>
                  {entry.tools.length === 0 ? (
                    <p className="text-[12px] text-[#857f76]">No tools discovered.</p>
                  ) : (
                    entry.tools.map((tool) => (
                      <label
                        key={tool.name}
                        className="flex cursor-pointer items-start gap-2 text-[13px]"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={isToolAllowed(entry.server.id, tool.name)}
                          onChange={() => toggleAllowedTool(entry.server.id, tool.name)}
                        />
                        <span>
                          <span className="font-medium">{tool.name}</span>
                          {tool.description ? (
                            <span className="text-[#857f76]"> — {tool.description}</span>
                          ) : null}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
