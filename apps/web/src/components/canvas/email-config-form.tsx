"use client";

import { X } from "lucide-react";
import type { EmailRecipient, PriorStepField } from "@rbrasier/domain";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { placeholderOptions, type EmailForm } from "./automation-step-model";
import { PersonPicker } from "./person-picker";

const SELECT_CLASS =
  "flex h-10 w-full rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-2 text-[13px] text-[#1c1b19] focus:border-wf-primary focus:bg-white focus:outline-hidden";

export interface DocumentStepOption {
  nodeId: string;
  stepLabel: string;
}

interface EmailConfigFormProps {
  form: EmailForm;
  onChange: (next: EmailForm) => void;
  priorStepFields: PriorStepField[];
  documentSteps: DocumentStepOption[];
  groups: { id: string; name: string }[];
  // Names for user recipients picked in this editor; a saved one shows generically.
  recipientNames: Record<string, string>;
  onRecipientNamed: (userId: string, name: string) => void;
}

const recipientKey = (recipient: EmailRecipient): string =>
  recipient.kind === "address"
    ? `address:${recipient.email.toLowerCase()}`
    : recipient.kind === "user"
      ? `user:${recipient.userId}`
      : `group:${recipient.groupId}`;

// The Email step editor (ADR-065 §4). Recipients are people, groups or fixed
// inboxes; the subject and body take placeholders for earlier steps' values.
export function EmailConfigForm({
  form,
  onChange,
  priorStepFields,
  documentSteps,
  groups,
  recipientNames,
  onRecipientNamed,
}: EmailConfigFormProps) {
  const set = <K extends keyof EmailForm>(key: K, value: EmailForm[K]) => onChange({ ...form, [key]: value });

  const addRecipient = (recipient: EmailRecipient) => {
    const key = recipientKey(recipient);
    if (form.recipients.some((existing) => recipientKey(existing) === key)) return;
    set("recipients", [...form.recipients, recipient]);
  };

  const describe = (recipient: EmailRecipient): string => {
    if (recipient.kind === "address") return recipient.email;
    if (recipient.kind === "group") {
      return `Group: ${groups.find((group) => group.id === recipient.groupId)?.name ?? "a saved group"}`;
    }
    return recipientNames[recipient.userId] ?? "A person chosen earlier";
  };

  const toggleAttachment = (nodeId: string, checked: boolean) =>
    set(
      "attachStepIds",
      checked ? [...form.attachStepIds, nodeId] : form.attachStepIds.filter((id) => id !== nodeId),
    );

  return (
    <>
      <div className="space-y-2">
        <FieldGroupLabel id="email-recipients">Recipients</FieldGroupLabel>
        {form.recipients.length === 0 ? (
          <p className="text-[12px] text-[#736d5f]">No recipients yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" aria-labelledby="email-recipients">
            {form.recipients.map((recipient) => (
              <li
                key={recipientKey(recipient)}
                className="flex items-center gap-1 rounded-full bg-[#f1efe9] px-2.5 py-1 text-[12px] text-[#1c1b19]"
              >
                {describe(recipient)}
                <button
                  type="button"
                  aria-label={`Remove ${describe(recipient)}`}
                  className="text-[#736d5f] hover:text-[#1c1b19]"
                  onClick={() =>
                    set(
                      "recipients",
                      form.recipients.filter((existing) => recipientKey(existing) !== recipientKey(recipient)),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <PersonPicker
          id="email-add-person"
          label="Add a person or inbox"
          placeholder="Search people, or type a full email address…"
          onPick={(person) => {
            if (person.userId) {
              onRecipientNamed(person.userId, person.displayName ?? person.email);
              addRecipient({ kind: "user", userId: person.userId });
              return;
            }
            addRecipient({ kind: "address", email: person.email });
          }}
        />
        {groups.length > 0 && (
          <div className="space-y-1">
            <Label htmlFor="email-add-group">Add a group</Label>
            <select
              id="email-add-group"
              className={SELECT_CLASS}
              value=""
              onChange={(event) => {
                if (event.target.value) addRecipient({ kind: "group", groupId: event.target.value });
              }}
            >
              <option value="">Choose a group…</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="email-subject">Subject</Label>
        <Input
          id="email-subject"
          value={form.subjectTemplate}
          onChange={(event) => set("subjectTemplate", event.target.value)}
          placeholder="e.g. Estimates hearing summary"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="email-body">Message</Label>
        <Textarea
          id="email-body"
          rows={6}
          value={form.bodyTemplate}
          onChange={(event) => set("bodyTemplate", event.target.value)}
          placeholder="Write the message. Insert values from earlier steps below."
        />
        {priorStepFields.length > 0 && (
          <div className="space-y-1">
            <Label htmlFor="email-insert-field">Insert a value from an earlier step</Label>
            <select
              id="email-insert-field"
              className={SELECT_CLASS}
              value=""
              onChange={(event) => {
                if (event.target.value) set("bodyTemplate", `${form.bodyTemplate}${event.target.value}`);
              }}
            >
              <option value="">Choose a field…</option>
              {placeholderOptions(priorStepFields).map((option) => (
                <option key={option.token} value={option.token}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {documentSteps.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-[13px] font-medium text-[#1c1b19]">Attach documents from</legend>
          {documentSteps.map((step) => (
            <label key={step.nodeId} className="flex items-center gap-2 text-[13px] text-[#1c1b19]">
              <input
                type="checkbox"
                checked={form.attachStepIds.includes(step.nodeId)}
                onChange={(event) => toggleAttachment(step.nodeId, event.target.checked)}
              />
              {step.stepLabel}
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}
