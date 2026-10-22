"use client";

import { useContext } from "react";
import { Plus, X } from "lucide-react";
import type { AiTaskReviewer, ApproverSourceMode, PriorStepField } from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { inputLabelFor, type AiTaskForm, type AiTaskInputRow } from "./automation-step-model";
import { FieldValueSelector, TriggerInputsContext } from "./field-value-selector";
import { InstructionToolBarWithPickers } from "./instruction-tool-bar";
import { PersonPicker } from "./person-picker";
import { TemplateFieldEditor } from "./template-field-editor";

const SELECT_CLASS =
  "flex h-10 w-full rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-2 text-[13px] text-[#1c1b19] focus:border-wf-primary focus:bg-white focus:outline-hidden";

type ReviewerChoice = "run_owner" | ApproverSourceMode | "user";

const reviewerChoiceOf = (reviewer: AiTaskReviewer): ReviewerChoice =>
  reviewer.mode === "approver_source" ? reviewer.approverSource : reviewer.mode;

const reviewerFor = (choice: ReviewerChoice, previous: AiTaskReviewer): AiTaskReviewer => {
  if (choice === "run_owner") return { mode: "run_owner" };
  if (choice === "user") return { mode: "user", userId: previous.mode === "user" ? previous.userId : "" };
  return { mode: "approver_source", approverSource: choice };
};

interface AiTaskConfigFormProps {
  form: AiTaskForm;
  onChange: (next: AiTaskForm) => void;
  priorStepFields: PriorStepField[];
  reviewerName: string | null;
  onReviewerPicked: (name: string) => void;
}

// The AI task step editor (ADR-065 §3): what to do, what it is given, what it
// must return, and who reviews a result the model is not confident in.
export function AiTaskConfigForm({
  form,
  onChange,
  priorStepFields,
  reviewerName,
  onReviewerPicked,
}: AiTaskConfigFormProps) {
  const set = <K extends keyof AiTaskForm>(key: K, value: AiTaskForm[K]) => onChange({ ...form, [key]: value });
  const triggerInputs = useContext(TriggerInputsContext);
  const updateInput = (index: number, next: AiTaskInputRow) =>
    set(
      "inputs",
      form.inputs.map((row, position) => (position === index ? next : row)),
    );
  // A new input starts on the first earlier field, already named after it.
  const newInputRow = (): AiTaskInputRow => {
    const first = priorStepFields[0];
    if (!first) return { label: "", source: { kind: "ai" } };
    return {
      label: first.field.label,
      source: { kind: "step_field", nodeId: first.nodeId, fieldKey: first.field.key },
    };
  };
  const choice = reviewerChoiceOf(form.reviewer);

  return (
    <>
      <div className="space-y-1">
        <InstructionToolBarWithPickers
          instructionId="ai-task-instruction"
          label="Instruction"
          skillRefs={form.skillRefs}
          allowedMcpToolRefs={form.allowedMcpToolRefs}
          onSkillRefsChange={(ids) => set("skillRefs", ids)}
          onToolRefsChange={(refs) => set("allowedMcpToolRefs", refs)}
        />
        <Textarea
          id="ai-task-instruction"
          rows={4}
          value={form.instruction}
          onChange={(event) => set("instruction", event.target.value)}
          placeholder="e.g. Summarise this hearing transcript in one page for the Minister's office."
        />
        <p className="text-[12px] text-[#736d5f]">
          Runs with no one at the keyboard. Earlier steps&apos; captured data is always included.
        </p>
      </div>

      <div className="space-y-2">
        <FieldGroupLabel id="ai-task-inputs">Inputs (optional)</FieldGroupLabel>
        <p className="text-[12px] text-[#736d5f]">
          Values from earlier steps handed to the AI by name, e.g. Transcript.
        </p>
        {form.inputs.map((row, index) => (
          <div key={index} className="flex items-start gap-2 rounded-[9px] border border-[#e7e3db] p-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <FieldValueSelector
                value={row.source}
                onChange={(source) => {
                  const previousDefault = inputLabelFor(row.source, priorStepFields, triggerInputs);
                  const keepsName = row.label.trim() !== "" && row.label !== previousDefault;
                  const label = keepsName ? row.label : inputLabelFor(source, priorStepFields, triggerInputs);
                  updateInput(index, { source, label });
                }}
                priorStepFields={priorStepFields}
              />
              <Input
                aria-label={`Name of input ${index + 1}`}
                value={row.label}
                onChange={(event) => updateInput(index, { ...row, label: event.target.value })}
                placeholder="Name the AI sees, e.g. Transcript"
              />
            </div>
            <button
              type="button"
              aria-label={`Remove input ${row.label || index + 1}`}
              className="mt-2 text-[#736d5f] hover:text-[#1c1b19]"
              onClick={() => set("inputs", form.inputs.filter((_, position) => position !== index))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => set("inputs", [...form.inputs, newInputRow()])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add input
        </Button>
      </div>

      <TemplateFieldEditor
        label="Output fields (at least one)"
        helpText="What the AI must return, e.g. Summary (narrative). The AI fills them as structured JSON, and later steps can use these values."
        lines={form.outputLines}
        onChange={(lines) => set("outputLines", lines)}
        disallowSection
      />

      <div className="space-y-1">
        <Label htmlFor="ai-task-threshold">Confidence needed to continue automatically (0–100)</Label>
        <Input
          id="ai-task-threshold"
          type="number"
          min={0}
          max={100}
          value={form.confidenceThreshold}
          onChange={(event) => set("confidenceThreshold", Number(event.target.value))}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="ai-task-reviewer">Below that, send the result for review to</Label>
        <select
          id="ai-task-reviewer"
          className={SELECT_CLASS}
          value={choice}
          onChange={(event) => set("reviewer", reviewerFor(event.target.value as ReviewerChoice, form.reviewer))}
        >
          <option value="run_owner">The run&apos;s owner</option>
          <option value="first_level_supervisor">The run owner&apos;s supervisor</option>
          <option value="second_level_supervisor">The run owner&apos;s manager once removed</option>
          <option value="dynamic">A named role (from the people directory)</option>
          <option value="user">A specific person</option>
        </select>
        <p className="text-[12px] text-[#736d5f]">
          If a supervisor or role cannot be found, the run&apos;s owner reviews instead.
        </p>
      </div>

      {form.reviewer.mode === "approver_source" && form.reviewer.approverSource === "dynamic" && (
        <div className="space-y-1">
          <Label htmlFor="ai-task-role">Role</Label>
          <Input
            id="ai-task-role"
            value={form.reviewer.roleHint ?? ""}
            onChange={(event) =>
              set("reviewer", { mode: "approver_source", approverSource: "dynamic", roleHint: event.target.value })
            }
            placeholder="e.g. Director, Parliamentary Services"
          />
        </div>
      )}

      {form.reviewer.mode === "user" && (
        <div className="space-y-1">
          {form.reviewer.userId && (
            <p className="text-[13px] text-[#1c1b19]">
              Reviewer: <span className="font-medium">{reviewerName ?? "the person chosen earlier"}</span>
            </p>
          )}
          <PersonPicker
            id="ai-task-reviewer-person"
            label={form.reviewer.userId ? "Change reviewer" : "Reviewer"}
            onPick={(person) => {
              if (!person.userId) return;
              set("reviewer", { mode: "user", userId: person.userId });
              onReviewerPicked(person.displayName ?? person.email);
            }}
          />
          <p className="text-[12px] text-[#736d5f]">Only people with a Wayfinder account can review.</p>
        </div>
      )}
    </>
  );
}
