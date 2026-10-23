"use client";

import { useEffect, useRef, useState } from "react";
import type { PriorStepField } from "@rbrasier/domain";
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
import { trpc } from "@/trpc/client";
import { AiTaskConfigForm } from "./ai-task-config-form";
import {
  aiTaskConfigFromForm,
  aiTaskFormFromConfig,
  emailConfigFromForm,
  emailFormFromConfig,
  type AiTaskForm,
  type EmailForm,
} from "./automation-step-model";
import { EmailConfigForm, type DocumentStepOption } from "./email-config-form";

export type AutomationStepType = "ai_task" | "email";

export interface AutomationStepModalProps {
  open: boolean;
  type: AutomationStepType;
  initialName: string;
  initialConfig: Record<string, unknown>;
  // The step's feature flag is off for this author: the step stays visible and
  // deletable, but cannot be edited and does not run (ADR-065 §6a).
  disabledByAdmin: boolean;
  priorStepFields: PriorStepField[];
  // Every step's `{{ step_key.field }}` key, from `flowStepKeys`.
  stepKeys: ReadonlyMap<string, string>;
  documentSteps: DocumentStepOption[];
  allowedEmailDomains: string[];
  isSaving: boolean;
  onSave: (name: string, config: Record<string, unknown>) => void;
  onDelete?: () => void;
  onClose: () => void;
}

const TITLES: Record<AutomationStepType, string> = {
  ai_task: "AI task step",
  email: "Email step",
};

// The editor for the two unattended step types. Kept apart from
// NodeConfigModal, whose flat form state is shaped around conversational steps.
export function AutomationStepModal({
  open,
  type,
  initialName,
  initialConfig,
  disabledByAdmin,
  priorStepFields,
  stepKeys,
  documentSteps,
  allowedEmailDomains,
  isSaving,
  onSave,
  onDelete,
  onClose,
}: AutomationStepModalProps) {
  const [name, setName] = useState(initialName);
  const [aiTaskForm, setAiTaskForm] = useState<AiTaskForm>(() => aiTaskFormFromConfig(initialConfig));
  const [emailForm, setEmailForm] = useState<EmailForm>(() => emailFormFromConfig(initialConfig));
  const [names, setNames] = useState<Record<string, string>>({});
  const [reviewerName, setReviewerName] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const wasOpenRef = useRef(false);
  const groups = trpc.group.publishTargets.useQuery(undefined, { enabled: open && type === "email" });

  // Seed only on the open transition, as NodeConfigModal does, so a canvas
  // refresh while the editor is open cannot wipe the author's edits.
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setName(initialName);
      setAiTaskForm(aiTaskFormFromConfig(initialConfig));
      setEmailForm(emailFormFromConfig(initialConfig));
      setShowProblems(false);
    }
    wasOpenRef.current = open;
  }, [open, initialName, initialConfig]);

  const built =
    type === "ai_task" ? aiTaskConfigFromForm(aiTaskForm) : emailConfigFromForm(emailForm, allowedEmailDomains);

  const handleSave = () => {
    if (built.problems.length > 0) {
      setShowProblems(true);
      return;
    }
    onSave(name, built.config as unknown as Record<string, unknown>);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{TITLES[type]}</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="max-h-[70vh] space-y-4 overflow-y-auto">
          {disabledByAdmin ? (
            <p role="status" className="rounded-[9px] bg-[#fdf3e3] px-3 py-2 text-[13px] text-[#7a4b0c]">
              Disabled by administrator. This step will not run until it is turned back on.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="automation-step-name">Step name</Label>
                <Input id="automation-step-name" value={name} onChange={(event) => setName(event.target.value)} />
              </div>
              {type === "ai_task" ? (
                <AiTaskConfigForm
                  form={aiTaskForm}
                  onChange={setAiTaskForm}
                  priorStepFields={priorStepFields}
                  reviewerName={reviewerName}
                  onReviewerPicked={setReviewerName}
                />
              ) : (
                <EmailConfigForm
                  form={emailForm}
                  onChange={setEmailForm}
                  priorStepFields={priorStepFields}
                  stepKeys={stepKeys}
                  documentSteps={documentSteps}
                  groups={(groups.data ?? []).map((group) => ({ id: group.id, name: group.name }))}
                  recipientNames={names}
                  onRecipientNamed={(userId, label) => setNames((current) => ({ ...current, [userId]: label }))}
                />
              )}
              {showProblems && built.problems.length > 0 && (
                <ul role="alert" className="list-disc space-y-0.5 pl-5 text-[12.5px] text-[#b42318]">
                  {built.problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {onDelete && (
            <Button type="button" variant="ghost" onClick={onDelete}>
              Delete step
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {!disabledByAdmin && (
              <Button type="button" onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving…" : "Save"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
