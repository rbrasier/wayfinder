"use client";

import { X } from "lucide-react";
import type { FieldValueSource, PriorStepField, TemplateField } from "@rbrasier/domain";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TemplateFieldEditor } from "./template-field-editor";
import {
  FieldValueList,
  FieldValueSelector,
  ReadOnlyFieldList,
} from "./field-value-selector";
import type { NodeConfigValues } from "./node-config-modal";

// Author-added request field surface shared with the parent. Same shape as in
// the parent modal file; the parent still owns the array.
interface CustomRequestField {
  id: string;
  label: string;
  value: FieldValueSource;
}

interface WorkflowSummary {
  id: string;
  name: string;
  webhookUrl: string | null;
}

interface WorkflowSchema {
  hasExecutions: boolean;
}

interface Query<T> {
  isLoading: boolean;
  error: unknown;
  data?: T;
}

export interface NodeConfigModalAutoProps {
  values: NodeConfigValues;
  set: <K extends keyof NodeConfigValues>(key: K, value: NodeConfigValues[K]) => void;
  priorStepFields: PriorStepField[];
  workflowsQuery: Query<WorkflowSummary[]>;
  workflows: WorkflowSummary[];
  selectedWorkflow: WorkflowSummary | null;
  selectWorkflow: (workflowId: string) => void;
  schemaQuery: Query<unknown>;
  schema: WorkflowSchema | null;
  usesN8n: boolean;
  regularDerivedInputs: TemplateField[];
  advancedDerivedInputs: TemplateField[];
  derivedInputs: TemplateField[];
  derivedOutputs: TemplateField[];
  mockRequestFields: TemplateField[];
  requestLines: string[];
  setRequestLines: (lines: string[]) => void;
  responseLines: string[];
  setResponseLines: (lines: string[]) => void;
  customFields: CustomRequestField[];
  addCustomField: () => void;
  updateCustomLabel: (id: string, label: string) => void;
  updateCustomValue: (id: string, value: FieldValueSource) => void;
  removeCustomField: (id: string) => void;
  setFieldValue: (key: string, next: FieldValueSource) => void;
  openInfo: (variant: "inputs" | "outputs") => void;
}

const EXECUTOR_SELECT_CLASS =
  "flex h-10 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none";

export function NodeConfigModalAuto({
  values,
  set,
  priorStepFields,
  workflowsQuery,
  workflows,
  selectedWorkflow,
  selectWorkflow,
  schemaQuery,
  schema,
  usesN8n,
  regularDerivedInputs,
  advancedDerivedInputs,
  derivedInputs,
  derivedOutputs,
  mockRequestFields,
  requestLines,
  setRequestLines,
  responseLines,
  setResponseLines,
  customFields,
  addCustomField,
  updateCustomLabel,
  updateCustomValue,
  removeCustomField,
  setFieldValue,
  openInfo,
}: NodeConfigModalAutoProps) {
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="auto-instruction">Instruction for n8n</Label>
        <Textarea
          id="auto-instruction"
          required
          rows={4}
          value={values.instruction}
          onChange={(e) => set("instruction", e.target.value)}
          placeholder="Describe the task the n8n sub-workflow should perform…"
        />
      </div>

      <div className="space-y-1">
        <FieldGroupLabel id="ncm-executor">Executor</FieldGroupLabel>
        <div className="flex gap-3" role="radiogroup" aria-labelledby="ncm-executor">
          {(["n8n", "mock"] as const).map((executor) => (
            <label
              key={executor}
              className={`flex flex-1 cursor-pointer items-center justify-center rounded-[9px] border px-3 py-2 text-[13px] transition-colors ${
                values.executor === executor
                  ? "border-[#7c3aed] bg-[#f3eefc] font-medium text-[#7c3aed]"
                  : "border-[#dedad2] text-[#5a5650] hover:bg-[#efede8]"
              }`}
            >
              <input
                type="radio"
                className="sr-only"
                value={executor}
                checked={values.executor === executor}
                onChange={() => set("executor", executor)}
              />
              {executor === "n8n" ? "n8n webhook" : "Mock (testing)"}
            </label>
          ))}
        </div>
      </div>

      {values.executor === "n8n" && (
        <div className="space-y-1">
          <Label htmlFor="auto-workflow">n8n workflow</Label>
          {workflowsQuery.isLoading ? (
            <p className="text-[12px] text-[#6d6a65]">Loading workflows…</p>
          ) : workflowsQuery.error ? (
            <p className="text-[12px] text-[#c2385a]">
              Could not load workflows. Configure an n8n instance in Admin → Settings.
            </p>
          ) : (
            <select
              id="auto-workflow"
              className={EXECUTOR_SELECT_CLASS}
              value={values.workflowId ?? ""}
              onChange={(e) => selectWorkflow(e.target.value)}
            >
              <option value="">Select a workflow…</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.name}
                  {workflow.webhookUrl ? "" : " (no webhook trigger)"}
                </option>
              ))}
            </select>
          )}
          {selectedWorkflow && !selectedWorkflow.webhookUrl && (
            <p className="text-[12px] text-[#c2385a]">
              This workflow has no webhook trigger and cannot be called automatically.
            </p>
          )}
        </div>
      )}

      {usesN8n && values.workflowId && (
        <>
          <div className="space-y-2" role="group" aria-labelledby="ncm-request-fields">
            <FieldGroupLabel id="ncm-request-fields">Add request fields</FieldGroupLabel>
            <p className="text-[12px] text-[#6d6a65]">
              Choose where each value comes from: the AI, an earlier step, a typed value, or none.
            </p>
            {schemaQuery.isLoading ? (
              <p className="text-[12px] text-[#6d6a65]">Reading the workflow schema…</p>
            ) : (
              <>
                <FieldValueList
                  fields={regularDerivedInputs}
                  values={values.requestFieldValues}
                  onChange={setFieldValue}
                  priorStepFields={priorStepFields}
                />
                {derivedInputs.length === 0 && (
                  <p className="rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-3 text-[12px] text-[#6d6a65]">
                    No inputs found for this workflow
                    {schema && !schema.hasExecutions ? " (it hasn't run yet)" : ""}.{" "}
                    <button
                      type="button"
                      className="font-medium text-[#3a5fd9] underline"
                      onClick={() => openInfo("inputs")}
                    >
                      More info
                    </button>
                  </p>
                )}
                {customFields.map((field) => (
                  <div
                    key={field.id}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-start gap-2"
                  >
                    <Input
                      aria-label="Custom field name"
                      value={field.label}
                      onChange={(e) => updateCustomLabel(field.id, e.target.value)}
                      placeholder="Field name"
                    />
                    <FieldValueSelector
                      value={field.value}
                      onChange={(next) => updateCustomValue(field.id, next)}
                      priorStepFields={priorStepFields}
                    />
                    <button
                      type="button"
                      aria-label="Remove field"
                      className="mt-1 flex h-7 w-7 items-center justify-center rounded-md text-[#c2385a] transition-colors hover:bg-[#fdf3f5]"
                      onClick={() => removeCustomField(field.id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-[13px] font-medium text-[#3a5fd9] hover:underline"
                  onClick={addCustomField}
                >
                  + Add field
                </button>
                {advancedDerivedInputs.length > 0 && (
                  <details className="group mt-1">
                    <summary className="cursor-pointer list-none text-[13px] font-medium text-[#6d6a65] hover:text-[#605c57] [&::-webkit-details-marker]:hidden">
                      <span className="group-open:hidden">▶ Advanced fields</span>
                      <span className="hidden group-open:inline">▼ Advanced fields</span>
                    </summary>
                    <div className="mt-2 space-y-2 rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] p-3">
                      <FieldValueList
                        fields={advancedDerivedInputs}
                        values={values.requestFieldValues}
                        onChange={setFieldValue}
                        priorStepFields={priorStepFields}
                      />
                    </div>
                  </details>
                )}
              </>
            )}
          </div>

          <div className="space-y-1" role="group" aria-labelledby="ncm-expected-outputs">
            <FieldGroupLabel id="ncm-expected-outputs">Expected outputs (from n8n)</FieldGroupLabel>
            <p className="text-[12px] text-[#6d6a65]">
              Returned by the workflow and stored as this step&apos;s output.
            </p>
            {schemaQuery.isLoading ? (
              <p className="text-[12px] text-[#6d6a65]">Reading the workflow schema…</p>
            ) : derivedOutputs.length > 0 ? (
              <ReadOnlyFieldList fields={derivedOutputs} emptyText="" />
            ) : (
              <p className="rounded-[9px] border border-dashed border-[#dedad2] bg-[#f7f6f3] p-3 text-[12px] text-[#6d6a65]">
                No outputs found for this workflow
                {schema && !schema.hasExecutions ? " (it hasn't run yet)" : ""}.{" "}
                <button
                  type="button"
                  className="font-medium text-[#3a5fd9] underline"
                  onClick={() => openInfo("outputs")}
                >
                  More info
                </button>
              </p>
            )}
          </div>
        </>
      )}

      {!usesN8n && (
        <>
          <TemplateFieldEditor
            label="Request fields"
            helpText="Fields sent with the request. Use the same Label (type) syntax as document templates."
            lines={requestLines}
            onChange={setRequestLines}
          />
          {mockRequestFields.length > 0 && (
            <div className="space-y-2" role="group" aria-labelledby="ncm-field-values">
              <FieldGroupLabel id="ncm-field-values">Field values</FieldGroupLabel>
              <FieldValueList
                fields={mockRequestFields}
                values={values.requestFieldValues}
                onChange={setFieldValue}
                priorStepFields={priorStepFields}
              />
            </div>
          )}
          <TemplateFieldEditor
            label="Response fields (expected back)"
            helpText="The structured values the step is expected to return. Matched values are stored; anything else is left blank."
            lines={responseLines}
            onChange={setResponseLines}
          />
        </>
      )}
    </>
  );
}
