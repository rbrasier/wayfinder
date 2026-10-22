"use client";

import { useState } from "react";
import { Plug, Sparkles, X } from "lucide-react";
import type { McpToolRef } from "@rbrasier/domain";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";
import { McpPickerModal } from "./mcp-picker-modal";
import { SkillPickerModal } from "./skill-picker-modal";

// Only the fields the chips read off a resolved library skill.
interface SkillSummary {
  name: string;
}

export interface InstructionToolBarProps {
  instructionId: string;
  label: string;
  skillsEnabled: boolean;
  mcpEnabled: boolean;
  skillRefs: string[];
  allowedMcpToolRefs: McpToolRef[];
  skillsById: Map<string, SkillSummary>;
  onOpenSkillPicker: () => void;
  removeSkill: (id: string) => void;
  onOpenMcpPicker: () => void;
  toggleAllowedTool: (serverId: string, toolName: string) => void;
}

// The label row above an AI instruction with its "Add skills" / "Add MCP"
// buttons and the chips for what is attached (ADR-031, ADR-032). Shared by the
// conversational and AI task step editors so the two read the same.
export function InstructionToolBar({
  instructionId,
  label,
  skillsEnabled,
  mcpEnabled,
  skillRefs,
  allowedMcpToolRefs,
  skillsById,
  onOpenSkillPicker,
  removeSkill,
  onOpenMcpPicker,
  toggleAllowedTool,
}: InstructionToolBarProps) {
  return (
    <>
      <div className="flex items-center justify-between">
        <Label htmlFor={instructionId}>{label}</Label>
        <div className="flex items-center gap-1">
          {skillsEnabled && (
            <button
              type="button"
              onClick={onOpenSkillPicker}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#1c1b19]"
              aria-label="Add skills"
            >
              <Sparkles size={13} />
              {skillRefs.length > 0 ? `Skills · ${skillRefs.length}` : "Add skills"}
            </button>
          )}
          {mcpEnabled && (
            <button
              type="button"
              onClick={onOpenMcpPicker}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#1c1b19]"
              aria-label="Add MCP tools"
            >
              <Plug size={13} />
              {allowedMcpToolRefs.length > 0 ? `MCP · ${allowedMcpToolRefs.length}` : "Add MCP"}
            </button>
          )}
        </div>
      </div>
      {skillsEnabled && skillRefs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {skillRefs.map((id) => {
            const skill = skillsById.get(id);
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-full border border-wf-primary-dim bg-wf-primary-light px-2 py-0.5 text-[11px] text-wf-primary"
              >
                <Sparkles size={10} />
                {skill?.name ?? "Skill"}
                <button
                  type="button"
                  aria-label={`Remove ${skill?.name ?? "skill"}`}
                  className="text-wf-primary hover:text-[#25439c]"
                  onClick={() => removeSkill(id)}
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      {mcpEnabled && allowedMcpToolRefs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allowedMcpToolRefs.map((ref) => (
            <span
              key={`${ref.serverId}:${ref.toolName}`}
              className="inline-flex items-center gap-1 rounded-full border border-[#cbd8c5] bg-[#eef4ea] px-2 py-0.5 text-[11px] text-[#3f7a2e]"
            >
              <Plug size={10} />
              {ref.toolName}
              <button
                type="button"
                aria-label={`Remove ${ref.toolName}`}
                className="text-[#3f7a2e] hover:text-[#2c5920]"
                onClick={() => toggleAllowedTool(ref.serverId, ref.toolName)}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// The same bar with its own pickers and flag checks, for an editor that does
// not already host them (the AI task step).
export function InstructionToolBarWithPickers({
  instructionId,
  label,
  skillRefs,
  allowedMcpToolRefs,
  onSkillRefsChange,
  onToolRefsChange,
}: {
  instructionId: string;
  label: string;
  skillRefs: string[];
  allowedMcpToolRefs: McpToolRef[];
  onSkillRefsChange: (ids: string[]) => void;
  onToolRefsChange: (refs: McpToolRef[]) => void;
}) {
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [mcpPickerOpen, setMcpPickerOpen] = useState(false);
  const skillsEnabled = trpc.featureFlag.isEnabledForMe.useQuery({ key: "skills" }).data ?? false;
  const mcpEnabled = trpc.featureFlag.isEnabledForMe.useQuery({ key: "mcp" }).data ?? false;
  const skillsQuery = trpc.skill.list.useQuery(undefined, { enabled: skillsEnabled });
  const mcpServersQuery = trpc.mcpServer.listWithTools.useQuery(undefined, { enabled: mcpEnabled });
  const skillsById = new Map((skillsQuery.data ?? []).map((skill) => [skill.id, skill]));
  const isToolAllowed = (serverId: string, toolName: string) =>
    allowedMcpToolRefs.some((ref) => ref.serverId === serverId && ref.toolName === toolName);
  const toggleAllowedTool = (serverId: string, toolName: string) =>
    onToolRefsChange(
      isToolAllowed(serverId, toolName)
        ? allowedMcpToolRefs.filter((ref) => !(ref.serverId === serverId && ref.toolName === toolName))
        : [...allowedMcpToolRefs, { serverId, toolName }],
    );

  return (
    <>
      <InstructionToolBar
        instructionId={instructionId}
        label={label}
        skillsEnabled={skillsEnabled}
        mcpEnabled={mcpEnabled}
        skillRefs={skillRefs}
        allowedMcpToolRefs={allowedMcpToolRefs}
        skillsById={skillsById}
        onOpenSkillPicker={() => setSkillPickerOpen(true)}
        removeSkill={(id) => onSkillRefsChange(skillRefs.filter((existing) => existing !== id))}
        onOpenMcpPicker={() => setMcpPickerOpen(true)}
        toggleAllowedTool={toggleAllowedTool}
      />
      <SkillPickerModal
        open={skillPickerOpen}
        selectedIds={skillRefs}
        onChange={onSkillRefsChange}
        onClose={() => setSkillPickerOpen(false)}
      />
      <McpPickerModal
        open={mcpPickerOpen}
        servers={mcpServersQuery.data ?? []}
        isToolAllowed={isToolAllowed}
        toggleAllowedTool={toggleAllowedTool}
        onClose={() => setMcpPickerOpen(false)}
      />
    </>
  );
}
