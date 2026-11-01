"use client";

import type { WatchCondition, WatchMatchOperator } from "@wayfinder/domain";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SampleFieldSelect } from "./sample-field-select";
import { conditionOfKind, type SampleFieldOption } from "./watch-model";

const SELECT_CLASS =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs";

const KIND_LABELS: Record<WatchCondition["kind"], string> = {
  transition: "A field changes to a value",
  matches: "A field matches a value",
  new_item: "A new item appears",
  changed: "A field changes at all",
};

const OPERATOR_LABELS: Record<WatchMatchOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  regex: "matches the pattern",
};

interface ConditionBuilderProps {
  condition: WatchCondition;
  onChange: (condition: WatchCondition) => void;
  // The sample's fields the condition can watch; empty before a Test.
  fieldOptions: SampleFieldOption[];
}

export function ConditionBuilder({ condition, onChange, fieldOptions }: ConditionBuilderProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="watch-condition-kind">Start a run when</Label>
        <select
          id="watch-condition-kind"
          className={SELECT_CLASS}
          value={condition.kind}
          onChange={(event) => onChange(conditionOfKind(event.target.value as WatchCondition["kind"], condition))}
        >
          {(Object.keys(KIND_LABELS) as Array<WatchCondition["kind"]>).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </select>
      </div>

      {condition.kind !== "new_item" && (
        <SampleFieldSelect
          id="watch-condition-field"
          label="Field"
          value={condition.fieldPath}
          onChange={(fieldPath) => onChange({ ...condition, fieldPath })}
          options={fieldOptions}
          emptyLabel="Choose the field to watch"
          manualPlaceholder="status"
        />
      )}

      {condition.kind === "transition" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="watch-condition-from">From (optional)</Label>
            <Input
              id="watch-condition-from"
              value={condition.from ?? ""}
              onChange={(event) => onChange({ ...condition, from: event.target.value === "" ? null : event.target.value })}
              placeholder="Any other value"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="watch-condition-to">To</Label>
            <Input
              id="watch-condition-to"
              value={condition.to}
              onChange={(event) => onChange({ ...condition, to: event.target.value })}
              placeholder="finished"
            />
          </div>
        </div>
      )}

      {condition.kind === "matches" && (
        <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="watch-condition-operator">Comparison</Label>
            <select
              id="watch-condition-operator"
              className={SELECT_CLASS}
              value={condition.operator}
              onChange={(event) => onChange({ ...condition, operator: event.target.value as WatchMatchOperator })}
            >
              {(Object.keys(OPERATOR_LABELS) as WatchMatchOperator[]).map((operator) => (
                <option key={operator} value={operator}>
                  {OPERATOR_LABELS[operator]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="watch-condition-value">Value</Label>
            <Input
              id="watch-condition-value"
              value={condition.value}
              onChange={(event) => onChange({ ...condition, value: event.target.value })}
            />
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {condition.kind === "matches"
          ? "Fires when an item starts matching, not on every check while it still matches."
          : condition.kind === "new_item"
            ? "Items already there when the watch starts never fire."
            : "Values are compared exactly, so the number 1 and the text \"1\" differ."}
      </p>
    </div>
  );
}
