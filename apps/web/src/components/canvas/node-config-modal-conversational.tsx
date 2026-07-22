"use client";

import { type ChangeEvent, type RefObject } from "react";
import { HelpCircle, Plug, Sparkles, X } from "lucide-react";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { NodeConfigValues } from "./node-config-modal";
import type { OutputType } from "./output-type";
import { StructuredFieldEditor } from "./structured-field-editor";

const EXAMPLE_TAG = "{{First name}}";

type DoneWhenMode = "never" | "template" | "condition";

// The three output types with their author-facing labels (ADR-038). The
// document type keeps "Generate document" in its label so existing selectors
// resolve it unchanged.
const OUTPUT_TYPE_OPTIONS: { value: OutputType; label: string }[] = [
  { value: "generate_document", label: "Generate document (from template)" },
  { value: "structured", label: "Structured conversation" },
  { value: "unstructured", label: "Unstructured conversation" },
];

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
  handleOutputTypeChange: (outputType: NodeConfigValues["outputType"]) => void;
  // Raw `Label (annotations)` lines for a structured conversation's field set.
  structuredLines: string[];
  onStructuredLinesChange: (lines: string[]) => void;
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
  onOpenMcpPicker: () => void;
  toggleAllowedTool: (serverId: string, toolName: string) => void;
}

export function NodeConfigModalConversational({
  values,
  set,
  doneWhenMode,
  handleDoneWhenModeChange,
  handleOutputTypeChange,
  structuredLines,
  onStructuredLinesChange,
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
  onOpenMcpPicker,
  toggleAllowedTool,
}: NodeConfigModalConversationalProps) {
  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="ai-instruction">Instructions for the AI</Label>
          <div className="flex items-center gap-1">
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
            {mcpEnabled && (
              <button
                type="button"
                onClick={onOpenMcpPicker}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-[#6d6a65] transition-colors hover:bg-[#efede8] hover:text-[#1a1814]"
                aria-label="Add MCP tools"
              >
                <Plug size={13} />
                {values.allowedMcpToolRefs.length > 0
                  ? `MCP · ${values.allowedMcpToolRefs.length}`
                  : "Add MCP"}
              </button>
            )}
          </div>
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
        {mcpEnabled && values.allowedMcpToolRefs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {values.allowedMcpToolRefs.map((ref) => (
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
        <Textarea
          id="ai-instruction"
          required
          rows={4}
          value={values.aiInstruction}
          onChange={(e) => set("aiInstruction", e.target.value)}
          placeholder="Describe what the AI should do in this step…"
        />
      </div>

      <div className="space-y-1">
        <FieldGroupLabel id="ncm-output-type">Output type</FieldGroupLabel>
        <div className="flex gap-3" role="radiogroup" aria-labelledby="ncm-output-type">
          {OUTPUT_TYPE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`flex flex-1 cursor-pointer items-center justify-center rounded-[9px] border px-3 py-2 text-center text-[13px] transition-colors ${
                values.outputType === option.value
                  ? "border-[#3a5fd9] bg-[#eef1fc] font-medium text-[#3a5fd9]"
                  : "border-[#dedad2] text-[#5a5650] hover:bg-[#efede8]"
              }`}
            >
              <input
                type="radio"
                className="sr-only"
                value={option.value}
                checked={values.outputType === option.value}
                onChange={() => handleOutputTypeChange(option.value)}
              />
              {option.label}
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
            <div className="space-y-1.5">
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
                    set("documentTemplateFormat", null);
                    set("spreadsheetTemplateMode", null);
                    setUploadError(null);
                  }}
                  disabled={isUploading}
                >
                  Remove
                </button>
              </div>
              {values.documentTemplateFormat === "xlsx" && (
                <p className="text-[12px] text-[#6d6a65]">
                  Spreadsheet detected —{" "}
                  <span className="font-medium text-[#247c53]">
                    {values.spreadsheetTemplateMode === "tags" ? "Tag mode" : "Header-row mode"}
                  </span>
                  {values.spreadsheetTemplateMode === "tags"
                    ? " (its {{ tags }} become the fields)"
                    : " (its header row becomes the fields)"}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="w-full rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-4 text-center text-[13px] text-[#6d6a65] transition-colors hover:border-[#c5d0f7] hover:bg-[#eef1fc] hover:text-[#3a5fd9] disabled:opacity-50"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading ? "Uploading…" : "Click to upload a .docx or .xlsx template"}
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx,.xlsx"
            className="sr-only"
            onChange={handleFileChange}
          />
          {uploadError && <p className="text-[12px] text-[#c2385a]">{uploadError}</p>}
        </div>
      )}

      {values.outputType === "structured" && (
        <StructuredFieldEditor
          lines={structuredLines}
          onChange={onStructuredLinesChange}
          onOpenHelp={onOpenHelpDialog}
        />
      )}

      {(values.outputType === "generate_document" || values.outputType === "structured") && (
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="allow-manual-edit">Allow manual field editing</Label>
            <p className="text-[12px] text-[#6d6a65]">
              {values.outputType === "structured"
                ? "Operators can correct the captured field values on the record after this step completes."
                : "Operators can correct the generated document’s field values before approval."}
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
          {(values.outputType === "generate_document" || values.outputType === "structured") && (
            <option value="template">All fields captured — when every field is gathered</option>
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
            This step is complete when all required fields have been gathered from the user.
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
