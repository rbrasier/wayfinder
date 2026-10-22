"use client";

import type { AiTaskReviewer, ApproverSourceMode, PriorStepField } from "@rbrasier/domain";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AiTaskForm } from "./automation-step-model";
import { FieldValueList } from "./field-value-selector";
import { PersonPicker } from "./person-picker";
import { parseFieldLines, TemplateFieldEditor } from "./template-field-editor";

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
  const inputFields = parseFieldLines(form.inputLines).fields;
  const choice = reviewerChoiceOf(form.reviewer);

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="ai-task-instruction">Instruction</Label>
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

      <TemplateFieldEditor
        label="Inputs (optional)"
        helpText="Named values handed to the AI, e.g. Transcript. Use the same Label (type) syntax as document templates."
        lines={form.inputLines}
        onChange={(lines) => set("inputLines", lines)}
      />
      {inputFields.length > 0 && (
        <div className="space-y-2">
          <FieldGroupLabel id="ai-task-input-values">Where each input comes from</FieldGroupLabel>
          <FieldValueList
            fields={inputFields}
            values={form.inputFieldValues}
            onChange={(key, next) => set("inputFieldValues", { ...form.inputFieldValues, [key]: next })}
            priorStepFields={priorStepFields}
          />
        </div>
      )}

      <TemplateFieldEditor
        label="Output fields"
        helpText="What the AI must return, e.g. Summary (narrative). Later steps can use these values."
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
