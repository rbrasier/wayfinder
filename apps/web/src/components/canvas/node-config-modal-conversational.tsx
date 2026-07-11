"use client";

import { type ChangeEvent, type RefObject } from "react";
import { HelpCircle, Sparkles, X } from "lucide-react";
import type { McpServerWithTools } from "@rbrasier/domain";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { NodeConfigValues } from "./node-config-modal";

const EXAMPLE_TAG = "{{First name}}";

type DoneWhenMode = "never" | "template" | "condition";

// Only the fields this view reads off a resolved library skill.
interface SkillSummary {
  name: string;
}

// The conversational-step section of NodeConfigModal. Extracted verbatim from
// the original monolithic modal (Group D item 10 split): the parent still owns
// state, so this component is a presentation view over `values` + `set`.
export interface NodeConfigModalConversationalProps {
  values: NodeConfigValues;
  set: <K extends keyof NodeConfigValues>(key: K, value: NodeConfigValues[K]) => void;
  doneWhenMode: DoneWhenMode;
  handleDoneWhenModeChange: (mode: string) => void;
  onUploadTemplate?: unknown;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleFileChange: (e: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  isUploading: boolean;
  uploadError: string | null;
  setUploadError: (value: string | null) => void;
  onOpenHelpDialog: () => void;
  // Power-user surfaces (ADR-022). When the flag is off the section is hidden.
  skillsEnabled: boolean;
  mcpEnabled: boolean;
  skillsById: Map<string, SkillSummary>;
  onOpenSkillPicker: () => void;
  removeSkill: (id: string) => void;
  mcpServers: McpServerWithTools[];
  isToolAllowed: (serverId: string, toolName: string) => boolean;
  toggleAllowedTool: (serverId: string, toolName: string) => void;
}

export function NodeConfigModalConversational({
  values,
  set,
  doneWhenMode,
  handleDoneWhenModeChange,
  onUploadTemplate,
  fileInputRef,
  handleFileChange,
  isUploading,
  uploadError,
  setUploadError,
  onOpenHelpDialog,
  skillsEnabled,
  mcpEnabled,
  skillsById,
  onOpenSkillPicker,
  removeSkill,
  mcpServers,
  isToolAllowed,
  toggleAllowedTool,
}: NodeConfigModalConversationalProps) {
  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="ai-instruction">Instructions for the AI</Label>
          {skillsEnabled && (
            <button
              type="button"
              onClick={onOpenSkillPicker}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
              aria-label="Add skills"
            >
              <Sparkles size={13} />
              {values.skillRefs.length > 0 ? `Skills · ${values.skillRefs.length}` : "Add skills"}
            </button>
          )}
        </div>
        {skillsEnabled && values.skillRefs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {values.skillRefs.map((id) => {
              const skill = skillsById.get(id);
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full border border-[#c5d0f7] bg-[#eef1fc] px-2 py-0.5 text-[11px] text-[#3a5fd9]"
                >
                  <Sparkles size={10} />
                  {skill?.name ?? "Skill"}
                  <button
                    type="button"
                    aria-label={`Remove ${skill?.name ?? "skill"}`}
                    className="text-[#3a5fd9] hover:text-[#25439c]"
                    onClick={() => removeSkill(id)}
                  >
                    <X size={11} />
                  </button>
                </span>
              );
            })}
          </div>
        )}
        <Textarea
          id="ai-instruction"
          required
          rows={4}
          value={values.aiInstruction}
          onChange={(e) => set("aiInstruction", e.target.value)}
          placeholder="Describe what the AI should do in this step…"
        />
      </div>

      {mcpEnabled && (
        <div className="space-y-1">
          <FieldGroupLabel id="ncm-mcp-tools">MCP tools</FieldGroupLabel>
          <p className="text-[12px] text-[#857f76]">
            Let the AI call these tools mid-conversation. Register servers on the MCP Servers page.
          </p>
          {mcpServers.length === 0 ? (
            <p className="text-[13px] text-[#857f76]">No MCP servers available.</p>
          ) : (
            <div className="space-y-2 rounded-[9px] border border-[#dedad2] p-2.5">
              {mcpServers.map((entry) => (
                <div key={entry.server.id} className="space-y-1">
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
        </div>
      )}

      <div className="space-y-1">
        <FieldGroupLabel id="ncm-output-type">Output type</FieldGroupLabel>
        <div className="flex gap-3" role="radiogroup" aria-labelledby="ncm-output-type">
          {(["conversation_only", "generate_document"] as const).map((type) => (
            <label
              key={type}
              className={`flex flex-1 cursor-pointer items-center justify-center rounded-[9px] border px-3 py-2 text-[13px] transition-colors ${
                values.outputType === type
                  ? "border-[#3a5fd9] bg-[#eef1fc] font-medium text-[#3a5fd9]"
                  : "border-[#dedad2] text-[#5a5650] hover:bg-[#efede8]"
              }`}
            >
              <input
                type="radio"
                className="sr-only"
                value={type}
                checked={values.outputType === type}
                onChange={() => set("outputType", type)}
              />
              {type === "conversation_only" ? "Conversation only" : "Generate document"}
            </label>
          ))}
        </div>
      </div>

      {values.outputType === "generate_document" && (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <FieldGroupLabel>DOCX template</FieldGroupLabel>
            <button
              type="button"
              aria-label="How template tags work"
              className="flex h-4 w-4 items-center justify-center rounded-full text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
              onClick={onOpenHelpDialog}
            >
              <HelpCircle size={13} />
            </button>
          </div>
          <p className="text-[12px] text-[#6d6a65]">
            Works best using variables marked with tags (e.g{" "}
            <code className="font-mono">{EXAMPLE_TAG}</code>)
          </p>
          {!onUploadTemplate ? (
            <p className="rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-3 text-[12px] text-[#6d6a65]">
              Save this step first, then re-open to upload a template.
            </p>
          ) : values.documentTemplateFilename ? (
            <div className="flex items-center gap-2 rounded-[9px] border border-[#c0e8d5] bg-[#eaf6f0] px-3 py-2">
              <span className="flex-1 truncate text-[12px] text-[#247c53]">
                {values.documentTemplateFilename}
              </span>
              <button
                type="button"
                className="shrink-0 text-[12px] text-[#6d6a65] hover:text-[#5a5650]"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
              >
                Replace
              </button>
              <button
                type="button"
                className="shrink-0 text-[12px] text-[#c2385a] hover:text-[#a02e4b]"
                onClick={() => {
                  set("documentTemplatePath", null);
                  set("documentTemplateFilename", null);
                  set("documentTemplateContent", null);
                  setUploadError(null);
                }}
                disabled={isUploading}
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-4 text-center text-[13px] text-[#6d6a65] transition-colors hover:border-[#c5d0f7] hover:bg-[#eef1fc] hover:text-[#3a5fd9] disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? "Uploading…" : "Click to upload a .docx template"}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            className="sr-only"
            onChange={handleFileChange}
          />
          {uploadError && <p className="text-[12px] text-[#c2385a]">{uploadError}</p>}
        </div>
      )}

      {values.outputType === "generate_document" && (
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="allow-manual-edit">Allow manual field editing</Label>
            <p className="text-[12px] text-[#6d6a65]">
              Operators can correct the generated document&apos;s field values before approval.
            </p>
          </div>
          <button
            id="allow-manual-edit"
            type="button"
            role="switch"
            aria-checked={values.allowManualEdit}
            onClick={() => set("allowManualEdit", !values.allowManualEdit)}
            className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              values.allowManualEdit ? "bg-[#1f8a4c]" : "bg-[#d7d3cc]"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                values.allowManualEdit ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="done-when-mode">Done when…</Label>
        <select
          id="done-when-mode"
          className="flex h-10 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none"
          value={doneWhenMode}
          onChange={(e) => handleDoneWhenModeChange(e.target.value)}
        >
          <option value="condition">Specific condition</option>
          {values.outputType === "generate_document" && (
            <option value="template">Template complete — when all template fields are gathered</option>
          )}
          <option value="never">Never done — user can continue to interact indefinitely</option>
        </select>
        {doneWhenMode === "condition" && (
          <Textarea
            id="done-when"
            required
            rows={2}
            value={values.doneWhen}
            onChange={(e) => set("doneWhen", e.target.value)}
            placeholder="Describe the condition that marks this step complete…"
          />
        )}
        {doneWhenMode === "template" && (
          <p className="rounded-[9px] border border-[#c5d0f7] bg-[#eef1fc] px-3 py-2 text-[12px] text-[#3a5fd9]">
            This step is complete when all required fields in the document template have been gathered from the user.
          </p>
        )}
      </div>

      {doneWhenMode !== "never" && (
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="require-confirmation">Require confirmation before completing this step</Label>
            <p className="text-[12px] text-[#6d6a65]">
              When this step is complete, hold it open until the operator clicks Proceed instead of advancing automatically.
            </p>
          </div>
          <button
            id="require-confirmation"
            type="button"
            role="switch"
            aria-checked={values.requireConfirmation}
            onClick={() => set("requireConfirmation", !values.requireConfirmation)}
            className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              values.requireConfirmation ? "bg-[#1f8a4c]" : "bg-[#d7d3cc]"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                values.requireConfirmation ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      )}
    </>
  );
}
