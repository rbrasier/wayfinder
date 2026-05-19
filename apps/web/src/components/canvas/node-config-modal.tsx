"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const COLOURS = [
  { hex: "#6366f1", label: "Indigo", class: "bg-indigo-500" },
  { hex: "#10b981", label: "Emerald", class: "bg-emerald-500" },
  { hex: "#f59e0b", label: "Amber", class: "bg-amber-500" },
  { hex: "#ef4444", label: "Red", class: "bg-red-500" },
  { hex: "#8b5cf6", label: "Violet", class: "bg-violet-500" },
  { hex: "#06b6d4", label: "Cyan", class: "bg-cyan-500" },
];

export interface NodeConfigValues {
  name: string;
  colour: string;
  aiInstruction: string;
  doneWhen: string;
  outputType: "conversation_only" | "generate_document";
}

interface NodeConfigModalProps {
  open: boolean;
  initialValues?: Partial<NodeConfigValues>;
  onSave: (values: NodeConfigValues) => void;
  onDelete?: () => void;
  onClose: () => void;
  isSaving?: boolean;
}

const DEFAULT_VALUES: NodeConfigValues = {
  name: "",
  colour: "#6366f1",
  aiInstruction: "",
  doneWhen: "",
  outputType: "conversation_only",
};

export function NodeConfigModal({
  open,
  initialValues,
  onSave,
  onDelete,
  onClose,
  isSaving = false,
}: NodeConfigModalProps) {
  const [values, setValues] = useState<NodeConfigValues>({ ...DEFAULT_VALUES, ...initialValues });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = <K extends keyof NodeConfigValues>(key: K, value: NodeConfigValues[K]) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const handleSave = () => {
    if (!values.name.trim() || !values.aiInstruction.trim() || !values.doneWhen.trim()) return;
    onSave(values);
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      setConfirmDelete(false);
      onClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        {confirmDelete ? (
          <>
            <DialogHeader>
              <DialogTitle>Remove step?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              This will delete the step and all its connected edges. This cannot be undone.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={onDelete}>
                Remove step
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Configure step</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="node-name">Step name</Label>
                <Input
                  id="node-name"
                  required
                  value={values.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Gather requirements"
                />
              </div>

              <div className="space-y-2">
                <Label>Step colour</Label>
                <div className="flex gap-2">
                  {COLOURS.map((colour) => (
                    <button
                      key={colour.hex}
                      type="button"
                      className={`h-7 w-7 rounded-full ${colour.class} transition-transform ${values.colour === colour.hex ? "ring-2 ring-offset-2 ring-gray-900 scale-110" : "opacity-70 hover:opacity-100"}`}
                      onClick={() => set("colour", colour.hex)}
                      title={colour.label}
                    />
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-instruction">Instructions for the AI</Label>
                <Textarea
                  id="ai-instruction"
                  required
                  rows={4}
                  value={values.aiInstruction}
                  onChange={(e) => set("aiInstruction", e.target.value)}
                  placeholder="Describe what the AI should do in this step…"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="done-when">Done when…</Label>
                <Textarea
                  id="done-when"
                  required
                  rows={2}
                  value={values.doneWhen}
                  onChange={(e) => set("doneWhen", e.target.value)}
                  placeholder="Describe the condition that marks this step complete…"
                />
              </div>

              <div className="space-y-2">
                <Label>Output type</Label>
                <div className="flex gap-3">
                  {(["conversation_only", "generate_document"] as const).map((type) => (
                    <label
                      key={type}
                      className={`flex flex-1 cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm transition-colors ${values.outputType === type ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        value={type}
                        checked={values.outputType === type}
                        onChange={() => set("outputType", type)}
                      />
                      {type === "conversation_only" ? "Conversation only" : "Generate document"}
                    </label>
                  ))}
                </div>
              </div>

              {values.outputType === "generate_document" && (
                <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">
                  Upload a .docx template — available after Phase 3
                </div>
              )}
            </div>

            <DialogFooter className="flex-row items-center justify-between">
              {onDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                >
                  Remove step
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button type="button" variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || !values.name.trim() || !values.aiInstruction.trim() || !values.doneWhen.trim()}
                >
                  {isSaving ? "Saving…" : "Save"}
                </Button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
