"use client";

import { MessageSquare, Stamp, Timer, Zap } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { STEP_TYPE_ACCENT } from "./node-styles";
import type { NodeConfigType } from "./node-config-modal";

interface NodeTypeOption {
  type: NodeConfigType;
  label: string;
  description: string;
  Icon: typeof MessageSquare;
}

const ALL_OPTIONS: NodeTypeOption[] = [
  {
    type: "conversational",
    label: "Conversational",
    description: "A human takes a turn with the AI to complete this step.",
    Icon: MessageSquare,
  },
  {
    type: "auto",
    label: "Automated (n8n)",
    description: "Runs automatically via an n8n sub-workflow — no conversation.",
    Icon: Zap,
  },
  {
    type: "scheduled",
    label: "Scheduled",
    description: "Pauses the session and resumes at a computed time.",
    Icon: Timer,
  },
  {
    type: "approval",
    label: "Approval",
    description: "Pauses the session until a confirmed approver signs off.",
    Icon: Stamp,
  },
];

interface NodeTypePickerModalProps {
  open: boolean;
  autoNodeEnabled?: boolean;
  scheduledNodeEnabled?: boolean;
  approvalNodeEnabled?: boolean;
  onSelect: (type: NodeConfigType) => void;
  onClose: () => void;
}

export function NodeTypePickerModal({
  open,
  autoNodeEnabled = false,
  scheduledNodeEnabled = false,
  approvalNodeEnabled = true,
  onSelect,
  onClose,
}: NodeTypePickerModalProps) {
  const options = ALL_OPTIONS.filter((option) => {
    if (option.type === "auto") return autoNodeEnabled;
    if (option.type === "scheduled") return scheduledNodeEnabled;
    if (option.type === "approval") return approvalNodeEnabled;
    return true;
  });

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a step</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="space-y-2">
          <p className="text-[13px] text-[#5a5650]">Choose the type of step to add.</p>
          {options.map(({ type, label, description, Icon }) => {
            const accent = STEP_TYPE_ACCENT[type];
            return (
              <button
                key={type}
                type="button"
                onClick={() => onSelect(type)}
                className="flex w-full items-start gap-3 rounded-[9px] border border-[#dedad2] bg-white px-3 py-3 text-left transition-colors hover:border-[#c5d0f7] hover:bg-[#f7f8fc]"
              >
                <span
                  aria-hidden
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: `${accent}1a`, color: accent }}
                >
                  <Icon size={16} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-[#1a1814]">{label}</span>
                  <span className="block text-[12px] text-[#918d87]">{description}</span>
                </span>
              </button>
            );
          })}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
