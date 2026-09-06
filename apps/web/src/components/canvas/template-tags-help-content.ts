// The field-types help, as data rather than markup, so what each editor is told
// it can author is asserted in a unit test rather than read off a rendered
// dialog. `template` documents `.docx` tags; `structured` documents the same
// vocabulary minus the constructs a structured step cannot save.
export type HelpVariant = "template" | "structured";

export interface AnnotationRow {
  annotation: string;
  meaning: string;
}

export interface HelpSection {
  title: string;
  blurb?: string;
  rows: AnnotationRow[];
}

export interface HelpContent {
  title: string;
  intro: string;
  example: string;
  sections: HelpSection[];
  examplesLabel: string;
  examples: string[];
  closing: string;
}

const TYPE_ROWS: AnnotationRow[] = [
  { annotation: "(text)", meaning: "Default — free text. Can be omitted." },
  { annotation: "(date)", meaning: "AI returns DD-MM-YYYY" },
  { annotation: "(currency)", meaning: "A number formatted as currency, e.g. $1,200.00" },
  { annotation: "(number)", meaning: "A plain number" },
  { annotation: "(email)", meaning: "A valid email address" },
  { annotation: "(yesno)", meaning: "Shorthand for a Yes / No answer" },
];

const OPTION_ROWS: AnnotationRow[] = [
  { annotation: "(options: A, B, C)", meaning: "AI must return exactly one of the listed values" },
  { annotation: "(multi-options: A, B, C)", meaning: "Shorthand — AI may return one or more of the listed values (comma-separated)" },
  { annotation: "(multiple)", meaning: "Combined with (options: …) — allows multiple values to be selected" },
];

const CONSTRAINT_ROWS: AnnotationRow[] = [
  { annotation: "(maxlen: 100)", meaning: "Text constrained to N characters" },
  { annotation: "(optional)", meaning: "Field can be left blank if unknown — AI won't be penalised" },
  { annotation: "(max: 100)", meaning: "Number / currency maximum; on a multi-options field, caps the number of values that can be selected" },
  { annotation: "(min: 100)", meaning: "Number or currency minimum" },
];

const narrativeRows = (variant: HelpVariant): AnnotationRow[] => [
  {
    annotation: "(narrative)",
    meaning: `The AI composes prose for this field — for open-ended answers like a background, scope or rationale. Written into ${variant === "template" ? "the document" : "the record"} but excluded from reporting.`,
  },
  {
    annotation: '(narrative: "brief")',
    meaning:
      'Same, with a brief saying what the prose must cover, e.g. (narrative: "Summarise the strategic rationale in 2–3 paragraphs"). The AI uses the brief to explain to the person what is needed and ask for anything missing, then writes their answer up. The brief cannot contain brackets.',
  },
];

const SIGNATURE_ROWS: AnnotationRow[] = [
  {
    annotation: "(approval)",
    meaning:
      "A signature slot, filled by the approval step that signs it — approver name, decision, UTC timestamp, comment and a verification code. Never asked for in chat, never editable by hand, and implicitly optional so an unsigned document is not treated as incomplete. Takes no other annotation. Cannot go inside a (repeat) block: one approval is one decision, not a list. .docx only.",
  },
];

const SECTION_ROWS: AnnotationRow[] = [
  {
    annotation: "{{#Section Name}} … {{/Section Name}}",
    meaning: "Wraps an optional section. The AI decides Yes/No whether to include it; if No, the whole block is omitted. The decision is reportable.",
  },
];

const GROUP_ROWS: AnnotationRow[] = [
  {
    annotation: "{{#Name (repeat)}} … {{/Name}}",
    meaning: "Wraps a repeating group. The AI returns a list of records and the block renders once per item, filling the {{fields}} inside from each item. Add (repeat) to the open tag — without it the block is an optional section, not a list. Only the item count is reportable.",
  },
  {
    annotation: "{{#Name (repeat) (max: 50)}}",
    meaning: "Caps the number of items the AI may return (default 20). Groups cannot be nested inside sections or other groups.",
  },
];

const TEMPLATE_EXAMPLES = [
  "{{ Approval Status (options: Approved, Rejected, Pending) (optional) }}",
  "{{ Skills (multi-options: Python, Go, Rust) (max: 3) }}",
  "{{ Tags (options: Urgent, Billing, Legal) (multiple) (optional) }}",
  "{{ Contract Value (currency) (optional) }}",
  "{{ Employee Email (email) }}",
  "{{ Notes (text) (maxlen: 200) (optional) }}",
  '{{ Background (narrative: "Summarise the rationale in 2–3 paragraphs") }}',
  "{{ Delegate Sign Off (approval) }}",
  "{{#Risk Section}} … {{ Risk Narrative (narrative) }} … {{/Risk Section}}",
  "{{#Recommendations (repeat)}} {{ Owner }}: {{ Action }} {{/Recommendations}}",
];

const STRUCTURED_EXAMPLES = [
  "Approval Status (options: Approved, Rejected, Pending) (optional)",
  "Skills (multi-options: Python, Go, Rust) (max: 3)",
  "Contract Value (currency) (optional)",
  "Employee Email (email)",
  "Notes (text) (maxlen: 200) (optional)",
  'Scope (narrative: "What is in scope, what is explicitly excluded, and any assumptions")',
];

// A structured step saves nothing document-shaped: `validateStructuredFieldSet`
// rejects `section` and `signature` outright, and a repeating group is a
// render-time construct. Documenting them here would describe a field the
// author cannot save.
const documentOnlySections = (): HelpSection[] => [
  {
    title: "Signatures",
    blurb:
      "Put one of these wherever an approver's sign-off belongs. Each signature slot is claimed by one approval step in the flow, so a document needing a delegate and a finance sign-off carries two slots and two approval steps.",
    rows: SIGNATURE_ROWS,
  },
  {
    title: "Optional sections",
    blurb:
      "Wrap a block of the template between matching open / close tags to make it optional. The names must match exactly, and a section pairs well with narrative fields inside it.",
    rows: SECTION_ROWS,
  },
  {
    title: "Repeating groups",
    blurb:
      "Use a repeating group for a list where every item has the same fields — a recommendations table, an options appraisal, a set of suppliers. Mark the open tag with (repeat); the AI extracts a list and the block renders once per item. Groups are kept flat (no nesting) and only their item count is reported.",
    rows: GROUP_ROWS,
  },
];

export const helpDialogContent = (variant: HelpVariant): HelpContent => {
  const isTemplate = variant === "template";

  const sections: HelpSection[] = [
    { title: "Type keywords", rows: TYPE_ROWS },
    { title: "Options / enum", rows: OPTION_ROWS },
    { title: "Constraints", rows: CONSTRAINT_ROWS },
    {
      title: "Narrative prose",
      blurb: isTemplate
        ? "Use these for open-ended, narrative-driven documents — committee papers, business cases, board reports — where the AI should write the content rather than slot in a value. Narrative fields are filled into the document but kept out of reporting."
        : "Use one wherever the answer is prose rather than a value — a scope, a background, a rationale. Give it a brief and the AI explains to the person what the field needs, asks for anything missing, then writes their answer up. Narrative values are kept out of reporting.",
      rows: narrativeRows(variant),
    },
    ...(isTemplate ? documentOnlySections() : []),
  ];

  if (isTemplate) {
    return {
      title: "Template tags & validation",
      intro:
        "Your .docx template must contain at least one {{ tag }} placeholder. The AI reads the tag names to know what to gather from you during chat, then fills them in when the document is generated. Add an annotation in brackets after the field name to control the format and add validation — this keeps generated documents consistent and makes the values usable for reporting.",
      example: `Client: {{ Client Name }}\nStart date: {{ Start Date (date) }}\nFee: {{ Contract Value (currency) (optional) }}`,
      sections,
      examplesLabel: "Combining annotations",
      examples: TEMPLATE_EXAMPLES,
      closing:
        "Spacing inside the brackets doesn't matter — ( email ), (email) and (min:  60) all work. If an annotation isn't recognised, the upload is rejected with an explanation so you can fix it before the template goes live.",
    };
  }

  return {
    title: "Field types & validation",
    intro:
      "Each field you add has a name and a type. The AI reads both to know what to ask you for during the conversation, and records the answer against that field. Use the cog to set whether it is required, add choices, and set limits — the same vocabulary a document template gets, so a field behaves identically either way.",
    example: `Client Name\nStart Date (date)\nContract Value (currency) (optional)`,
    sections,
    examplesLabel: "Combining settings",
    examples: STRUCTURED_EXAMPLES,
    closing:
      "You set all of this from the type dropdown and the cog — the bracket form above is just how each field is written down. A setting that does not apply to a field's type is not offered.",
  };
};
