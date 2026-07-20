"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { IconPicker } from "./icon-picker";

const ICONS = ["🗂️", "🏗️", "💬", "📋", "🔄", "⚙️"];

export interface FlowMetadataValues {
  name: string;
  expertRole: string;
  description: string;
  icon: string;
}

interface FlowMetadataDialogProps {
  open: boolean;
  mode: "create" | "edit";
  initialValues?: Partial<FlowMetadataValues>;
  isSaving?: boolean;
  onSubmit: (values: FlowMetadataValues) => void;
  onClose: () => void;
}

const emptyValues: FlowMetadataValues = {
  name: "",
  expertRole: "",
  description: "",
  icon: ICONS[0] ?? "🗂️",
};

export function FlowMetadataDialog({
  open,
  mode,
  initialValues,
  isSaving = false,
  onSubmit,
  onClose,
}: FlowMetadataDialogProps) {
  const [values, setValues] = useState<FlowMetadataValues>({ ...emptyValues, ...initialValues });

  useEffect(() => {
    if (open) {
      setValues({ ...emptyValues, ...initialValues });
    }
  }, [open, initialValues]);

  const canSubmit = values.name.trim().length > 0 && values.expertRole.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      name: values.name.trim(),
      expertRole: values.expertRole.trim(),
      description: values.description.trim(),
      icon: values.icon,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New Flow" : "Edit Flow"}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <div className="space-y-1">
            <Label htmlFor="flow-name">Name</Label>
            <Input
              id="flow-name"
              required
              value={values.name}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
              placeholder="e.g. Client onboarding"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="flow-expert-role">Expert role</Label>
            <Input
              id="flow-expert-role"
              required
              value={values.expertRole}
              onChange={(e) => setValues({ ...values, expertRole: e.target.value })}
              placeholder="e.g. Senior employment lawyer"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="flow-desc">Description</Label>
            <Input
              id="flow-desc"
              value={values.description}
              onChange={(e) => setValues({ ...values, description: e.target.value })}
              placeholder="Optional description"
            />
          </div>
          <div className="space-y-1">
            <FieldGroupLabel id="flow-icon-label">Icon</FieldGroupLabel>
            <div className="flex items-center gap-2" role="group" aria-labelledby="flow-icon-label">
              {ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className={`flex h-10 w-10 items-center justify-center rounded-[9px] border text-xl transition-colors ${
                    values.icon === icon
                      ? "border-[#3a5fd9] bg-[#eef1fc]"
                      : "border-[#dedad2] hover:bg-[#efede8]"
                  }`}
                  onClick={() => setValues({ ...values, icon })}
                >
                  {icon}
                </button>
              ))}
              {/* The current icon when it was chosen from the expanded set, so a
                  custom pick stays visible alongside the six quick options. */}
              {!ICONS.includes(values.icon) && (
                <div className="flex h-10 w-10 items-center justify-center rounded-[9px] border border-[#3a5fd9] bg-[#eef1fc] text-xl">
                  {values.icon}
                </div>
              )}
              <IconPicker value={values.icon} onChange={(icon) => setValues({ ...values, icon })} />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !canSubmit}>
            {isSaving ? "Saving…" : mode === "create" ? "Create flow" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
