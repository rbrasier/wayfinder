"use client";

import { MessageSquare, Plug, Stamp, Timer, Zap } from "lucide-react";
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

const PRIMARY_OPTIONS: NodeTypeOption[] = [
  {
    type: "conversational",
    label: "Conversational",
    description: "A human takes a turn with the AI to complete this step.",
    Icon: MessageSquare,
  },
  {
    type: "approval",
    label: "Approval",
    description: "Pauses the session until a confirmed approver signs off.",
    Icon: Stamp,
  },
  {
    type: "scheduled",
    label: "Scheduled",
    description: "Pauses the session and resumes at a computed time.",
    Icon: Timer,
  },
];

const ADVANCED_OPTIONS: NodeTypeOption[] = [
  {
    type: "auto",
    label: "Automated (n8n)",
    description: "Runs automatically via an n8n sub-workflow — no conversation.",
    Icon: Zap,
  },
  {
    type: "mcp",
    label: "MCP Tool",
    description: "Runs automatically by calling one tool on a registered MCP server.",
    Icon: Plug,
  },
];

interface NodeTypePickerModalProps {
  open: boolean;
  autoNodeEnabled?: boolean;
  scheduledNodeEnabled?: boolean;
  approvalNodeEnabled?: boolean;
  mcpNodeEnabled?: boolean;
  onSelect: (type: NodeConfigType) => void;
  onClose: () => void;
}

function PrimaryCard({
  type,
  label,
  description,
  Icon,
  onSelect,
}: NodeTypeOption & { onSelect: (type: NodeConfigType) => void }) {
  const accent = STEP_TYPE_ACCENT[type];
  return (
    <button
      type="button"
      onClick={() => onSelect(type)}
      className="flex flex-col items-start gap-2.5 rounded-[9px] border border-[#dedad2] bg-white p-3 text-left transition-colors hover:border-[#c5d0f7] hover:bg-[#f7f8fc]"
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: `${accent}1a`, color: accent }}
      >
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-[#1a1814]">{label}</span>
        <span className="block text-[11.5px] leading-snug text-[#918d87]">{description}</span>
      </span>
    </button>
  );
}

function AdvancedCard({
  type,
  label,
  description,
  Icon,
  onSelect,
}: NodeTypeOption & { onSelect: (type: NodeConfigType) => void }) {
  const accent = STEP_TYPE_ACCENT[type];
  return (
    <button
      type="button"
      onClick={() => onSelect(type)}
      className="flex w-full items-center gap-2.5 rounded-[8px] border border-[#dedad2] bg-white px-3 py-2.5 text-left transition-colors hover:border-[#c5d0f7] hover:bg-[#f7f8fc]"
    >
      <span
        aria-hidden
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: `${accent}1a`, color: accent }}
      >
        <Icon size={14} />
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-medium text-[#1a1814]">{label}</span>
        <span className="block text-[11px] leading-snug text-[#918d87]">{description}</span>
      </span>
    </button>
  );
}

export function NodeTypePickerModal({
  open,
  autoNodeEnabled = false,
  scheduledNodeEnabled = false,
  approvalNodeEnabled = true,
  mcpNodeEnabled = true,
  onSelect,
  onClose,
}: NodeTypePickerModalProps) {
  const primaryOptions = PRIMARY_OPTIONS.filter((option) => {
    if (option.type === "scheduled") return scheduledNodeEnabled;
    if (option.type === "approval") return approvalNodeEnabled;
    return true;
  });

  const advancedOptions = ADVANCED_OPTIONS.filter((option) => {
    if (option.type === "auto") return autoNodeEnabled;
    if (option.type === "mcp") return mcpNodeEnabled;
    return true;
  });

  const [row1, row2] = [primaryOptions.slice(0, 2), primaryOptions.slice(2)];

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a step</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="text-[13px] text-[#5a5650]">Choose the type of step to add.</p>
          <div className="space-y-2">
            {row1.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {row1.map((option) => (
                  <PrimaryCard key={option.type} {...option} onSelect={onSelect} />
                ))}
              </div>
            )}
            {row2.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {row2.map((option) => (
                  <PrimaryCard key={option.type} {...option} onSelect={onSelect} />
                ))}
              </div>
            )}
          </div>
          {advancedOptions.length > 0 && (
            <>
              <div className="border-t border-[#eceae4]" />
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-[#b8b4ad]">
                  Advanced
                </p>
                {advancedOptions.map((option) => (
                  <AdvancedCard key={option.type} {...option} onSelect={onSelect} />
                ))}
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
