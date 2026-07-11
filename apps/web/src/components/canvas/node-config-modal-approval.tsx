"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApproverSourceMode, NodeConfigValues } from "./node-config-modal";

const SELECT_CLASS =
  "flex h-10 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#1f8a4c] focus:bg-white focus:outline-none";

export interface NodeConfigModalApprovalProps {
  values: NodeConfigValues;
  set: <K extends keyof NodeConfigValues>(key: K, value: NodeConfigValues[K]) => void;
}

export function NodeConfigModalApproval({ values, set }: NodeConfigModalApprovalProps) {
  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="approver-source">Who approves?</Label>
        <select
          id="approver-source"
          className={SELECT_CLASS}
          value={values.approverSource}
          onChange={(e) => set("approverSource", e.target.value as ApproverSourceMode)}
        >
          <option value="first_level_supervisor">First-level supervisor</option>
          <option value="second_level_supervisor">Second-level supervisor</option>
          <option value="dynamic">Dynamic — resolved from policy/context</option>
        </select>
        <p className="text-[12px] text-[#6d6a65]">
          The operator always confirms the suggested approver, and can choose someone else.
        </p>
      </div>

      {values.approverSource === "dynamic" && (
        <div className="space-y-1">
          <Label htmlFor="approver-role-hint">Role hint (optional)</Label>
          <Input
            id="approver-role-hint"
            value={values.roleHint}
            onChange={(e) => set("roleHint", e.target.value)}
            placeholder="e.g. SES Band 1 delegate"
          />
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor="approval-instructions">Instructions (optional)</Label>
        <Textarea
          id="approval-instructions"
          rows={3}
          value={values.approvalInstructions}
          onChange={(e) => set("approvalInstructions", e.target.value)}
          placeholder="Shown to the operator and the approver…"
        />
      </div>
    </>
  );
}
