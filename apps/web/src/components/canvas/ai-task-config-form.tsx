"use client";

import { useContext, useState } from "react";
import { Plus, X } from "lucide-react";
import type {
  AiTaskProblemField,
  AiTaskReviewer,
  ApproverSourceMode,
  PriorStepField,
} from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AdvancedSection } from "./advanced-section";
import {
  aiTaskInputOptions,
  aiTaskReviewEnabled,
  withAiTaskReview,
  inputSourceFrom,
  inputSourceValue,
  type AiTaskEditorProblem,
  type AiTaskForm,
} from "./automation-step-model";
import { TriggerInputsContext } from "./field-value-selector";
import { InstructionToolBarWithPickers } from "./instruction-tool-bar";
import { PersonPicker } from "./person-picker";
import { INVALID_OUTLINE, FieldProblemText } from "@/components/ui/field-problem";
import { StructuredFieldEditor } from "./structured-field-editor";
import { TemplateTagsHelpDialog } from "./template-tags-help-dialog";

const SELECT_CLASS = `flex h-10 w-full rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-2 text-[13px] text-[#1c1b19] focus:border-wf-primary focus:bg-white focus:outline-hidden ${INVALID_OUTLINE}`;

type ReviewerChoice = "run_owner" | ApproverSourceMode | "user";

const reviewerChoiceOf = (reviewer: AiTaskReviewer): ReviewerChoice =>
  reviewer.mode === "approver_source" ? reviewer.approverSource : reviewer.mode;

const reviewerFor = (choice: ReviewerChoice, previous: AiTaskReviewer): AiTaskReviewer => {
  if (choice === "run_owner") return { mode: "run_owner" };
  if (choice === "user")
    return { mode: "user", userId: previous.mode === "user" ? previous.userId : "" };
  return { mode: "approver_source", approverSource: choice };
};

interface AiTaskConfigFormProps {
  form: AiTaskForm;
  onChange: (next: AiTaskForm) => void;
  priorStepFields: PriorStepField[];
  reviewerName: string | null;
  onReviewerPicked: (name: string) => void;
  // Save problems to show beside their fields; empty until the author tries to save.
  problems: AiTaskEditorProblem[];
}

// The AI task step editor (ADR-065 §3): what to do, what it is given, what it
// must return, and — under Advanced — when a person reviews the result.
export function AiTaskConfigForm({
  form,
  onChange,
  priorStepFields,
  reviewerName,
  onReviewerPicked,
  problems,
}: AiTaskConfigFormProps) {
  const set = <K extends keyof AiTaskForm>(key: K, value: AiTaskForm[K]) =>
    onChange({ ...form, [key]: value });
  const triggerInputs = useContext(TriggerInputsContext);
  const [helpOpen, setHelpOpen] = useState(false);
  const optionGroups = aiTaskInputOptions(priorStepFields, triggerInputs);
  const firstOption = optionGroups[0]?.options[0]?.value;
  const choice = reviewerChoiceOf(form.reviewer);
  const reviewOn = aiTaskReviewEnabled(form);

  const messagesFor = (field: AiTaskProblemField) =>
    problems
      .filter((problem) => problem.field === field && problem.outputRow === undefined)
      .map((problem) => problem.message);
  const invalid = (field: AiTaskProblemField) => (messagesFor(field).length > 0 ? true : undefined);
  const describedBy = (field: AiTaskProblemField) =>
    invalid(field) ? `ai-task-${field}-problem` : undefined;
  const rowErrors = new Map(
    problems.flatMap((problem) =>
      problem.outputRow === undefined ? [] : [[problem.outputRow, problem.message] as const],
    ),
  );

  const addInput = () => {
    const source = firstOption ? inputSourceFrom(firstOption) : null;
    if (source) set("inputs", [...form.inputs, source]);
  };

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
        <FieldProblemText id="ai-task-instruction-problem" messages={messagesFor("instruction")} />
        <Textarea
          id="ai-task-instruction"
          rows={4}
          className={INVALID_OUTLINE}
          aria-invalid={invalid("instruction")}
          aria-describedby={describedBy("instruction")}
          value={form.instruction}
          onChange={(event) => set("instruction", event.target.value)}
          placeholder="e.g. Summarise this hearing transcript in one page for the Minister's office."
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="ai-task-accept-all-inputs">Accept all inputs</Label>
            <p className="mt-0.5 text-[12px] text-[#736d5f]">
              {form.acceptAllInputs
                ? "The AI gets everything the run knows: what started it (an Event Watch item or webhook body) and every earlier step's values."
                : "The AI gets only the values picked below."}
            </p>
          </div>
          <button
            id="ai-task-accept-all-inputs"
            type="button"
            role="switch"
            aria-checked={form.acceptAllInputs}
            onClick={() => set("acceptAllInputs", !form.acceptAllInputs)}
            className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              form.acceptAllInputs ? "bg-[#1f6b4d]" : "bg-[#dedad2]"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                form.acceptAllInputs ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {!form.acceptAllInputs && (
          <div className="space-y-2">
            <FieldGroupLabel id="ai-task-inputs">Inputs</FieldGroupLabel>
            <FieldProblemText id="ai-task-inputs-problem" messages={messagesFor("inputs")} />
            {form.inputs.map((source, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  aria-label={`Input ${index + 1}`}
                  className={SELECT_CLASS}
                  value={inputSourceValue(source)}
                  onChange={(event) => {
                    const picked = inputSourceFrom(event.target.value);
                    if (!picked) return;
                    set(
                      "inputs",
                      form.inputs.map((existing, position) =>
                        position === index ? picked : existing,
                      ),
                    );
                  }}
                >
                  {optionGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label={`Remove input ${index + 1}`}
                  className="shrink-0 rounded-md p-1.5 text-[#666055] transition-colors hover:bg-[#f5f3ee] hover:text-[#a8324c]"
                  onClick={() =>
                    set(
                      "inputs",
                      form.inputs.filter((_, position) => position !== index),
                    )
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            {firstOption ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={addInput}
                aria-describedby={describedBy("inputs")}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add input
              </Button>
            ) : (
              <p className="text-[12px] text-[#736d5f]">
                No earlier step or trigger input has a value to pick yet. Accept all inputs, or add
                one first.
              </p>
            )}
          </div>
        )}
      </div>

      <StructuredFieldEditor
        label="Output fields (at least one)"
        description="What the AI must return. Pick a type, and use the cog for required, limits and choices. The AI fills them as structured JSON, and later steps can use these values."
        lines={form.outputLines}
        onChange={(lines) => set("outputLines", lines)}
        onOpenHelp={() => setHelpOpen(true)}
        problems={messagesFor("outputs")}
        rowErrors={rowErrors}
      />
      <TemplateTagsHelpDialog
        open={helpOpen}
        variant="structured"
        onClose={() => setHelpOpen(false)}
      />

      <AdvancedSection openWhen={Boolean(invalid("threshold") || invalid("reviewer"))}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="ai-task-review">Ask for a review when the AI is unsure</Label>
            <p className="mt-0.5 text-[12px] text-[#736d5f]">
              {reviewOn
                ? "Below the confidence set here, the result waits for a person to check it."
                : "Off: the flow carries on with whatever the AI produced."}
            </p>
          </div>
          <button
            id="ai-task-review"
            type="button"
            role="switch"
            aria-checked={reviewOn}
            onClick={() => onChange(withAiTaskReview(form, !reviewOn))}
            className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
              reviewOn ? "bg-[#1f6b4d]" : "bg-[#dedad2]"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                reviewOn ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>

        {reviewOn && (
          <>
            <div className="space-y-1">
              <Label htmlFor="ai-task-threshold">
                Confidence needed to continue automatically (0–100)
              </Label>
              <FieldProblemText
                id="ai-task-threshold-problem"
                messages={messagesFor("threshold")}
              />
              <Input
                id="ai-task-threshold"
                type="number"
                min={0}
                max={100}
                className={INVALID_OUTLINE}
                aria-invalid={invalid("threshold")}
                aria-describedby={describedBy("threshold")}
                value={form.confidenceThreshold}
                onChange={(event) => set("confidenceThreshold", Number(event.target.value))}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="ai-task-reviewer">Below that, send the result for review to</Label>
              <FieldProblemText id="ai-task-reviewer-problem" messages={messagesFor("reviewer")} />
              <select
                id="ai-task-reviewer"
                className={SELECT_CLASS}
                aria-invalid={invalid("reviewer")}
                aria-describedby={describedBy("reviewer")}
                value={choice}
                onChange={(event) =>
                  set("reviewer", reviewerFor(event.target.value as ReviewerChoice, form.reviewer))
                }
              >
                <option value="run_owner">The run&apos;s owner</option>
                <option value="first_level_supervisor">The run owner&apos;s supervisor</option>
                <option value="second_level_supervisor">
                  The run owner&apos;s manager once removed
                </option>
                <option value="dynamic">A named role (from the people directory)</option>
                <option value="user">A specific person</option>
              </select>
              <p className="text-[12px] text-[#736d5f]">
                If a supervisor or role cannot be found, the run&apos;s owner reviews instead.
              </p>
            </div>

            {form.reviewer.mode === "approver_source" &&
              form.reviewer.approverSource === "dynamic" && (
                <div className="space-y-1">
                  <Label htmlFor="ai-task-role">Role</Label>
                  <Input
                    id="ai-task-role"
                    value={form.reviewer.roleHint ?? ""}
                    onChange={(event) =>
                      set("reviewer", {
                        mode: "approver_source",
                        approverSource: "dynamic",
                        roleHint: event.target.value,
                      })
                    }
                    placeholder="e.g. Director, Parliamentary Services"
                  />
                </div>
              )}

            {form.reviewer.mode === "user" && (
              <div className="space-y-1">
                {form.reviewer.userId && (
                  <p className="text-[13px] text-[#1c1b19]">
                    Reviewer:{" "}
                    <span className="font-medium">
                      {reviewerName ?? "the person chosen earlier"}
                    </span>
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
                <p className="text-[12px] text-[#736d5f]">
                  Only people with a Wayfinder account can review.
                </p>
              </div>
            )}
          </>
        )}
      </AdvancedSection>
    </>
  );
}
