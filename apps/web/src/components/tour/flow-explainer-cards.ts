// The six cards of the flow explainer, in the order the story is told. Copy
// lives here rather than in the carousel so the sequence is testable and the
// illustrations can be keyed by id.
export type ExplainerCardId =
  | "conversation"
  | "steps"
  | "done-when"
  | "template"
  | "rules"
  | "publish";

export interface ExplainerCard {
  readonly id: ExplainerCardId;
  readonly title: string;
  readonly body: string;
}

export const EXPLAINER_CARDS: readonly ExplainerCard[] = [
  {
    id: "conversation",
    title: "A flow is a guided conversation, not a form",
    body: "The AI asks, the person answers, and something useful comes out the end — here, a leave request written up and ready to download.",
  },
  {
    id: "steps",
    title: "A flow is broken into steps",
    body: "Each step is one part of the conversation — gather the background, then the requirement, then the approvals. You lay them out and join them in order.",
  },
  {
    id: "done-when",
    title: "You tell each step what to do and when it's finished",
    body: "“Instructions for the AI” is what to ask. “Done when…” is how it knows to move on to the next step.",
  },
  {
    id: "template",
    title: "Your template is the form",
    body: "Upload a Word template with {{ Field Name (annotation) }} placeholders and the flow collects exactly those fields in conversation, then fills them in.",
  },
  {
    id: "rules",
    title: "Give the AI your rules, not just your questions",
    body: "Attach policies, guidelines or FAQs so the AI answers from your organisation's rules rather than general knowledge — the CPRs, your delegations schedule, the internal FAQ people keep asking about.",
  },
  {
    id: "publish",
    title: "Publish it",
    body: "Nothing your team sees changes until you publish a version. Once published, the flow appears under New chat for everyone you shared it with.",
  },
];

const lastIndex = EXPLAINER_CARDS.length - 1;

export const nextCardIndex = (index: number): number => Math.min(index + 1, lastIndex);

export const previousCardIndex = (index: number): number => Math.max(index - 1, 0);

export const isLastCard = (index: number): boolean => index >= lastIndex;
