"use client";

import { useContext, useRef } from "react";
import { X } from "lucide-react";
import type {
  EmailProblemField,
  EmailRecipient,
  PriorStepField,
  StepProblem,
} from "@wayfinder/domain";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { placeholderOptions, type EmailForm } from "./automation-step-model";
import { TriggerInputsContext } from "./field-value-selector";
import { InsertFieldMenu } from "./insert-field-menu";
import { MarkdownEditor } from "./markdown-editor";
import { RecipientAutosuggest } from "./recipient-autosuggest";
import { INVALID_OUTLINE, FieldProblemText } from "@/components/ui/field-problem";

export interface DocumentStepOption {
  nodeId: string;
  stepLabel: string;
}

interface EmailConfigFormProps {
  form: EmailForm;
  onChange: (next: EmailForm) => void;
  priorStepFields: PriorStepField[];
  stepKeys: ReadonlyMap<string, string>;
  documentSteps: DocumentStepOption[];
  groups: { id: string; name: string }[];
  // Names for user recipients picked in this editor; a saved one shows generically.
  recipientNames: Record<string, string>;
  onRecipientNamed: (userId: string, name: string) => void;
  // Save problems to show beside their fields; empty until the author tries to save.
  problems: StepProblem<EmailProblemField>[];
}

const recipientKey = (recipient: EmailRecipient): string =>
  recipient.kind === "address"
    ? `address:${recipient.email.toLowerCase()}`
    : recipient.kind === "user"
      ? `user:${recipient.userId}`
      : `group:${recipient.groupId}`;

// The Email step editor (ADR-065 §4). Recipients are people, groups or any
// address; the subject and the markdown message take placeholders for trigger
// inputs and earlier steps' values.
export function EmailConfigForm({
  form,
  onChange,
  priorStepFields,
  stepKeys,
  documentSteps,
  groups,
  recipientNames,
  onRecipientNamed,
  problems,
}: EmailConfigFormProps) {
  const messagesFor = (field: EmailProblemField) =>
    problems.filter((problem) => problem.field === field).map((problem) => problem.message);
  const problemIdFor = (field: EmailProblemField) =>
    messagesFor(field).length > 0 ? `email-${field}-problem` : undefined;
  const set = <K extends keyof EmailForm>(key: K, value: EmailForm[K]) =>
    onChange({ ...form, [key]: value });
  const triggerInputs = useContext(TriggerInputsContext);
  const insertOptions = placeholderOptions(priorStepFields, triggerInputs, stepKeys);
  const subjectRef = useRef<HTMLInputElement>(null);

  const insertIntoSubject = (token: string) => {
    const subject = subjectRef.current;
    const start = subject?.selectionStart ?? form.subjectTemplate.length;
    const end = subject?.selectionEnd ?? form.subjectTemplate.length;
    set(
      "subjectTemplate",
      `${form.subjectTemplate.slice(0, start)}${token}${form.subjectTemplate.slice(end)}`,
    );
  };

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
        <FieldProblemText id="email-recipients-problem" messages={messagesFor("recipients")} />
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
                      form.recipients.filter(
                        (existing) => recipientKey(existing) !== recipientKey(recipient),
                      ),
                    )
                  }
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <RecipientAutosuggest
          id="email-add-recipient"
          describedBy={problemIdFor("recipients")}
          groups={groups}
          onAdd={(recipient, name) => {
            if (recipient.kind === "user") onRecipientNamed(recipient.userId, name);
            addRecipient(recipient);
          }}
        />
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="email-subject">Subject</Label>
          <InsertFieldMenu
            fieldLabel="Subject"
            options={insertOptions}
            onInsert={insertIntoSubject}
          />
        </div>
        <FieldProblemText id="email-subject-problem" messages={messagesFor("subject")} />
        <Input
          ref={subjectRef}
          id="email-subject"
          className={INVALID_OUTLINE}
          aria-invalid={problemIdFor("subject") ? true : undefined}
          aria-describedby={problemIdFor("subject")}
          value={form.subjectTemplate}
          onChange={(event) => set("subjectTemplate", event.target.value)}
          placeholder="e.g. Estimates hearing summary"
        />
      </div>

      <MarkdownEditor
        id="email-body"
        label="Message"
        value={form.bodyTemplate}
        onChange={(bodyTemplate) => set("bodyTemplate", bodyTemplate)}
        insertOptions={insertOptions}
        problems={messagesFor("body")}
        placeholder="Write the message. Use Insert field for values from earlier steps."
      />

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
