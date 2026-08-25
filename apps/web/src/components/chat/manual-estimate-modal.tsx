"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ESTIMATE_PRESETS,
  draftMinutes,
  isSubmittable,
  type EstimateDraft,
  type EstimateMode,
} from "./manual-estimate-state";

const EMPTY_DRAFT: EstimateDraft = {
  mode: "preset",
  presetId: null,
  days: 0,
  hours: 0,
  exactMinutes: null,
};

const MODE_TABS: { id: EstimateMode; label: string }[] = [
  { id: "preset", label: "Pick one" },
  { id: "dayshours", label: "Days & hours" },
  { id: "exact", label: "Exact" },
];

interface ManualEstimateModalProps {
  open: boolean;
  flowName: string;
  isSaving: boolean;
  onSubmit: (minutes: number) => void;
  onSkip: () => void;
}

export function ManualEstimateModal({
  open,
  flowName,
  isSaving,
  onSubmit,
  onSkip,
}: ManualEstimateModalProps) {
  const [draft, setDraft] = useState<EstimateDraft>(EMPTY_DRAFT);
  const minutes = draftMinutes(draft);

  const numberField = (
    id: string,
    value: number,
    onChange: (next: number) => void,
    label: string,
  ) => (
    <div className="flex-1 space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={0}
        value={value === 0 ? "" : value}
        placeholder="0"
        onChange={(event) => {
          const parsed = Number.parseInt(event.target.value, 10);
          onChange(Number.isNaN(parsed) || parsed < 0 ? 0 : parsed);
        }}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onSkip()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>How long would this have taken the old way?</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-muted-foreground">
            A rough guess is all we need — it is what lets {flowName} report the time it saves. You
            can skip this.
          </p>

          <div className="flex gap-1 rounded-lg bg-muted p-1">
            {MODE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={draft.mode === tab.id}
                onClick={() => setDraft({ ...EMPTY_DRAFT, mode: tab.id })}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  draft.mode === tab.id
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {draft.mode === "preset" && (
            <div className="flex flex-wrap gap-2">
              {ESTIMATE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-pressed={draft.presetId === preset.id}
                  onClick={() => setDraft({ ...draft, presetId: preset.id })}
                  className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                    draft.presetId === preset.id
                      ? "border-primary bg-primary/10 font-medium text-primary"
                      : "border-border hover:border-foreground/30"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          {draft.mode === "dayshours" && (
            <div className="flex gap-3">
              {numberField(
                "manual-estimate-days",
                draft.days,
                (days) => setDraft({ ...draft, days }),
                "Days",
              )}
              {numberField(
                "manual-estimate-hours",
                draft.hours,
                (hours) => setDraft({ ...draft, hours }),
                "Hours",
              )}
            </div>
          )}

          {draft.mode === "exact" && (
            <div className="space-y-1">
              <Label htmlFor="manual-estimate-exact" className="text-xs text-muted-foreground">
                Minutes
              </Label>
              <Input
                id="manual-estimate-exact"
                type="number"
                min={1}
                value={draft.exactMinutes ?? ""}
                placeholder="e.g. 90"
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  setDraft({ ...draft, exactMinutes: Number.isNaN(parsed) ? null : parsed });
                }}
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter className="justify-between">
          <Button variant="ghost" onClick={onSkip} disabled={isSaving}>
            Skip
          </Button>
          <Button
            onClick={() => minutes !== null && onSubmit(minutes)}
            disabled={!isSubmittable(draft) || isSaving}
          >
            {isSaving ? "Saving…" : "Save estimate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
