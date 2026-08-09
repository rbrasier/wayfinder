"use client";

import type { PriorStepField } from "@rbrasier/domain";
import { Label } from "@/components/ui/label";
import { AdvancedSection } from "./advanced-section";
import { NodeConfigModalApprovalAdvanced } from "./node-config-modal-approval";
import { NodeConfigModalConversationalAdvanced } from "./node-config-modal-conversational";
import type { PriorStep } from "./approval-node-config";
import type { NodeConfigValues } from "./node-config-values";

type DoneWhenMode = "never" | "template" | "condition";

export interface NodeConfigModalAdvancedProps {
  values: NodeConfigValues;
  set: <K extends keyof NodeConfigValues>(key: K, value: NodeConfigValues[K]) => void;
  isConversational: boolean;
  isApproval: boolean;
  openWhen: boolean;
  doneWhenMode: DoneWhenMode;
  handleDoneWhenModeChange: (mode: string) => void;
  priorSteps: PriorStep[];
  priorStepFields: PriorStepField[];
  takenSignatureFieldKeys: string[];
}

// The one Advanced disclosure a step config shows, composed here rather than in
// each type view so a conversational or approval step ends in a single section
// instead of one for its own controls and another for the shared notify toggle.
//
// Auto, scheduled and MCP steps contribute nothing type-specific, so their
// section holds the notify toggle alone — which keeps that control in the same
// place for every step type.
export function NodeConfigModalAdvanced({
  values,
  set,
  isConversational,
  isApproval,
  openWhen,
  doneWhenMode,
  handleDoneWhenModeChange,
  priorSteps,
  priorStepFields,
  takenSignatureFieldKeys,
}: NodeConfigModalAdvancedProps) {
  return (
    <AdvancedSection openWhen={openWhen}>
      {isConversational && (
        <NodeConfigModalConversationalAdvanced
          values={values}
          set={set}
          doneWhenMode={doneWhenMode}
          handleDoneWhenModeChange={handleDoneWhenModeChange}
        />
      )}

      {isApproval && (
        <NodeConfigModalApprovalAdvanced
          values={values}
          set={set}
          priorSteps={priorSteps}
          priorStepFields={priorStepFields}
          takenSignatureFieldKeys={takenSignatureFieldKeys}
        />
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="notify-on-complete">Notify chat participants when step complete</Label>
          <p className="text-[12px] text-[#666055]">
            Emails everyone in the chat once this step finishes.
          </p>
        </div>
        <button
          id="notify-on-complete"
          type="button"
          role="switch"
          aria-checked={values.notifyOnComplete}
          onClick={() => set("notifyOnComplete", !values.notifyOnComplete)}
          className={`relative mt-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
            values.notifyOnComplete ? "bg-[#1f6b4d]" : "bg-[#dedad2]"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              values.notifyOnComplete ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </AdvancedSection>
  );
}
