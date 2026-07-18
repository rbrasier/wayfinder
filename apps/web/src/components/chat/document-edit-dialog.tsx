"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { DEFAULT_ITEM_CAP, type TemplateField } from "@rbrasier/domain";
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
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";

interface DocumentEditDialogProps {
  open: boolean;
  messageId: string;
  onClose: () => void;
  onSaved: () => void;
}

const splitMulti = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

export function DocumentEditDialog({ open, messageId, onClose, onSaved }: DocumentEditDialogProps) {
  const fieldsQuery = trpc.document.getFields.useQuery({ messageId }, { enabled: open });
  const updateMutation = trpc.document.updateFields.useMutation();

  const [values, setValues] = useState<Record<string, string>>({});
  const [groupItems, setGroupItems] = useState<Record<string, Array<Record<string, string>>>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Re-seed the form whenever fresh field values arrive for an opened dialog.
  useEffect(() => {
    if (!open || !fieldsQuery.data) return;
    const seeded: Record<string, string> = {};
    const seededGroups: Record<string, Array<Record<string, string>>> = {};
    for (const field of fieldsQuery.data.fields) {
      seeded[field.key] = field.value;
      if (field.type === "group") seededGroups[field.key] = field.items ?? [];
    }
    setValues(seeded);
    setGroupItems(seededGroups);
    setFieldErrors({});
  }, [open, fieldsQuery.data]);

  const setValue = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const setItems = (key: string, items: Array<Record<string, string>>) =>
    setGroupItems((prev) => ({ ...prev, [key]: items }));

  const handleSave = async () => {
    setFieldErrors({});
    const result = await updateMutation.mutateAsync({ messageId, values, groupItems });
    if (!result.ok) {
      // A group can raise several errors (one per bad item), all keyed to the
      // group field — accumulate them so none is lost.
      const next: Record<string, string> = {};
      for (const error of result.fieldErrors ?? []) {
        next[error.key] = next[error.key] ? `${next[error.key]} · ${error.message}` : error.message;
      }
      setFieldErrors(next);
      toast.error("Some fields need fixing.");
      return;
    }
    toast.success("Document updated");
    onSaved();
    onClose();
  };

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) onClose();
  };

  const data = fieldsQuery.data;
  const isEditable = data?.editable ?? false;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit document fields</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>

        <DialogBody className="max-h-[60vh] overflow-y-auto">
          {fieldsQuery.isLoading ? (
            <p className="text-[13px] text-[#6d6a65]">Loading fields…</p>
          ) : !data ? (
            <p className="text-[13px] text-[#c2385a]">Could not load document fields.</p>
          ) : !isEditable ? (
            <p className="rounded-[9px] border border-[#f5d0a9] bg-[#fdf3e3] px-3 py-2 text-[12px] text-[#9b6215]">
              {data.reason ?? "This document can no longer be edited."}
            </p>
          ) : (
            data.fields.map((field) =>
              field.type === "group" ? (
                <div key={field.key} className="space-y-1.5">
                  <Label>{field.label}</Label>
                  <GroupFieldEditor
                    field={field}
                    items={groupItems[field.key] ?? []}
                    onChange={(items) => setItems(field.key, items)}
                  />
                  {fieldErrors[field.key] && (
                    <p className="text-[12px] text-[#c2385a]">{fieldErrors[field.key]}</p>
                  )}
                </div>
              ) : (
                <FieldInput
                  key={field.key}
                  field={field}
                  value={values[field.key] ?? ""}
                  error={fieldErrors[field.key]}
                  onChange={(value) => setValue(field.key, value)}
                />
              ),
            )
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!isEditable || updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FieldInputProps {
  field: TemplateField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

const SELECT_CLASS =
  "flex h-10 w-full rounded-[9px] border border-[#dedad2] bg-[#f7f6f3] px-3 py-2 text-[13px] text-[#1a1814] focus:border-[#3a5fd9] focus:bg-white focus:outline-none";

function FieldInput({ field, value, error, onChange }: FieldInputProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`field-${field.key}`}>
        {field.label}
        {field.optional && <span className="ml-1 text-[11px] text-[#6d6a65]">(optional)</span>}
      </Label>
      <FieldControl field={field} value={value} onChange={onChange} />
      {error && <p className="text-[12px] text-[#c2385a]">{error}</p>}
    </div>
  );
}

interface GroupFieldEditorProps {
  field: TemplateField;
  items: Array<Record<string, string>>;
  onChange: (items: Array<Record<string, string>>) => void;
}

function GroupFieldEditor({ field, items, onChange }: GroupFieldEditorProps) {
  const subFields = field.itemFields ?? [];
  const cap = field.itemCap ?? DEFAULT_ITEM_CAP;
  const atCap = items.length >= cap;

  const updateItem = (index: number, key: string, value: string) =>
    onChange(items.map((item, position) => (position === index ? { ...item, [key]: value } : item)));

  const removeItem = (index: number) =>
    onChange(items.filter((_item, position) => position !== index));

  const addItem = () => {
    if (atCap) return;
    const blank: Record<string, string> = {};
    for (const subField of subFields) blank[subField.key] = "";
    onChange([...items, blank]);
  };

  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <p className="text-[12px] text-[#6d6a65]">No items yet — add one below.</p>
      )}
      {items.map((item, index) => (
        <div
          key={index}
          className="space-y-2 rounded-[9px] border border-[#dedad2] bg-[#faf9f7] p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#6d6a65]">
              Item {index + 1}
            </span>
            <button
              type="button"
              onClick={() => removeItem(index)}
              className="text-[12px] text-[#c2385a] hover:underline"
            >
              Remove
            </button>
          </div>
          {subFields.map((subField) => (
            <FieldInput
              key={subField.key}
              field={{ ...subField, key: `${field.key}-${index}-${subField.key}` }}
              value={item[subField.key] ?? ""}
              onChange={(value) => updateItem(index, subField.key, value)}
            />
          ))}
        </div>
      ))}
      <Button type="button" variant="ghost" onClick={addItem} disabled={atCap}>
        {atCap ? `Maximum ${cap} items reached` : "+ Add item"}
      </Button>
    </div>
  );
}

function FieldControl({ field, value, onChange }: Omit<FieldInputProps, "error">) {
  if (field.type === "section") {
    const included = value === "Yes";
    return (
      <button
        id={`field-${field.key}`}
        type="button"
        role="switch"
        aria-checked={included}
        onClick={() => onChange(included ? "No" : "Yes")}
        className="flex items-center gap-2 text-[13px] text-[#5a5650]"
      >
        <span
          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
            included ? "bg-[#1f8a4c]" : "bg-[#d7d3cc]"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              included ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </span>
        {included ? "Included" : "Omitted"}
      </button>
    );
  }

  if (field.type === "narrative") {
    return (
      <Textarea
        id={`field-${field.key}`}
        rows={4}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (field.type === "yesno") {
    return (
      <select
        id={`field-${field.key}`}
        className={SELECT_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select…</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }

  if (field.options && field.options.length > 0) {
    if (field.multiple) {
      const selected = new Set(splitMulti(value));
      const toggle = (option: string) => {
        const next = new Set(selected);
        if (next.has(option)) next.delete(option);
        else next.add(option);
        onChange(field.options!.filter((candidate) => next.has(candidate)).join(", "));
      };
      return (
        <div className="space-y-1.5">
          {field.options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-[13px] text-[#1a1814]">
              <input
                type="checkbox"
                checked={selected.has(option)}
                onChange={() => toggle(option)}
              />
              {option}
            </label>
          ))}
        </div>
      );
    }

    return (
      <select
        id={`field-${field.key}`}
        className={SELECT_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Select…</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <Input
      id={`field-${field.key}`}
      type="text"
      value={value}
      placeholder={field.type === "date" ? "DD-MM-YYYY" : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
