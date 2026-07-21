"use client";

import { useState } from "react";
import { ClipboardList, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/trpc/client";
import { DocumentEditDialog } from "./document-edit-dialog";

interface RecordCardProps {
  messageId: string;
  // When the node permits manual edits and the session is still editable.
  canEdit?: boolean;
  onEdited?: () => void;
}

// The completion card for a structured conversation (ADR-038 §4): the captured
// field values, with the same edit affordance as a document card. It reuses the
// manual-edit dialog (DocumentEditDialog) rather than a new editor — the record
// is the SessionStepOutput, read through the same document.getFields query.
export function RecordCard({ messageId, canEdit = false, onEdited }: RecordCardProps) {
  const [isEditOpen, setIsEditOpen] = useState(false);
  const fieldsQuery = trpc.document.getFields.useQuery({ messageId });

  const data = fieldsQuery.data;
  const fields = data?.fields ?? [];
  const editable = canEdit && (data?.editable ?? false);

  const renderValue = (field: (typeof fields)[number]): string => {
    if (field.type === "group") {
      const count = field.items?.length ?? 0;
      return count === 1 ? "1 item" : `${count} items`;
    }
    return field.value.trim() ? field.value : "—";
  };

  return (
    <div className="my-3 flex justify-center">
      <div
        data-testid="record-card"
        className="w-full max-w-sm rounded-[10px] border border-[#dedad2] bg-white p-[12px_14px] shadow-[0_1px_3px_rgba(0,0,0,.06),0_4px_14px_rgba(0,0,0,.05)]"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#eef1fc] text-[#3a5fd9]">
            <ClipboardList className="h-[18px] w-[18px] stroke-[1.8]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-[#1a1814]">Record</p>
            {fieldsQuery.isLoading ? (
              <p className="mt-1 text-[11px] text-[#6d6a65]">Loading record…</p>
            ) : fields.length === 0 ? (
              <p className="mt-1 text-[11px] text-[#6d6a65]">No fields captured.</p>
            ) : (
              <dl className="mt-1.5 space-y-1">
                {fields.map((field) => (
                  <div key={field.key} className="flex gap-2 text-[12px]">
                    <dt className="shrink-0 font-medium text-[#6d6a65]">{field.label}:</dt>
                    <dd className="min-w-0 flex-1 truncate text-[#1a1814]">{renderValue(field)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>

        {editable && (
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => setIsEditOpen(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Edit
            </Button>
          </div>
        )}
      </div>

      {editable && (
        <DocumentEditDialog
          open={isEditOpen}
          messageId={messageId}
          title="Edit record"
          onClose={() => setIsEditOpen(false)}
          onSaved={() => {
            fieldsQuery.refetch();
            onEdited?.();
          }}
        />
      )}
    </div>
  );
}
