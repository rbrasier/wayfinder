"use client";

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

interface TemplateTagsHelpDialogProps {
  open: boolean;
  onClose: () => void;
}

export function TemplateTagsHelpDialog({ open, onClose }: TemplateTagsHelpDialogProps) {
  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>How template tags work</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <DialogBody>
          <p className="text-[13px] leading-[1.55] text-[#5a5650]">
            Your <code className="font-mono">.docx</code> template must contain at least one{" "}
            <code className="font-mono">{"{{ tag }}"}</code> placeholder. The AI reads the tag
            names to know what to gather from you during chat, then fills them in when the
            document is generated.
          </p>
          <div className="rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] p-3">
            <pre className="m-0 whitespace-pre-wrap font-mono text-[12px] leading-[1.55] text-[#1a1814]">
{`Client: {{ client_name }}
Start date: {{ start_date }}
Project: {{ project_summary }}`}
            </pre>
          </div>
          <p className="text-[12px] leading-[1.55] text-[#918d87]">
            Use lowercase <code className="font-mono">snake_case</code>. Tag names become the
            labels the AI asks about during the conversation.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={onClose} autoFocus>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
