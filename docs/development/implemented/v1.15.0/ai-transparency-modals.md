# AI transparency info modals

## Problem

The AI agent already produces rich per-turn metadata — `rationale`,
`stepCompleteConfidence`, and `contextGathered` (an array of
`{ key, value }` insights). All of this is persisted on every assistant
message via `AiTurnPayload`, but only `stepCompleteConfidence` is exposed
in the UI (as `<ConfidenceBar>`). Users have no way to see *why* the AI
gave that confidence, what insights it believes it has gathered about the
flow so far, or — for generated documents — what the AI thinks of its
own output against the flow guidance and the step's completion criteria.

Two transparency surfaces are missing:

1. **Per-message rationale + accumulated insights**. The AI's `rationale`
   string and the running ledger of `contextGathered` insights across the
   whole session are invisible.
2. **Document generation alignment**. When a document is generated, the
   only confidence signal is the same `stepCompleteConfidence` that
   triggered the step to advance — there is no separate read on whether
   the generated document aligns with the flow's guidance documents or
   with the criteria written for that specific step.

## Behaviour change

- Every AI message bubble that has an `aiPayload` shows a small
  `Info` icon in its bottom-right corner. Clicking opens a modal:
  - **Confidence rationale** — the `rationale` string the AI returned
    on that turn, plus the headline confidence percentage already shown
    on the bubble (re-used `<ConfidenceBar>`).
  - **Insights gathered so far** — a collapsed `<details>` section
    that, when expanded, shows the accumulated `{ key, value }` pairs
    drawn from every assistant message in the session up to and
    including this one. Duplicate keys are deduplicated keeping the
    most recent value (the AI may refine an answer across turns).
- The icon is hidden when `aiPayload` is null (greeting messages or
  pre-1.15.0 historical rows). It is also hidden on user messages and
  on streaming-only messages that haven't yet been persisted.
- The `<DocumentCard>` shown beneath the milestone pill gets the same
  `Info` icon in its top-right corner. Clicking opens a modal showing
  **two** confidence-bar rows, each with its own rationale paragraph:
  - **Alignment to flow guidance** — how well the generated document
    matches the guidance documentation attached to the flow
    (`Flow.contextDocs`).
  - **Alignment to step criteria** — how well the generated document
    satisfies the completion criteria configured on the step node
    (`ConversationalNodeConfig.completionCriteria`).
- The icon on the document card is hidden when the message has no
  `documentGenerationConfidence` block (historical documents).

## Affected entities

- `AiTurnPayload` (in `packages/domain/src/entities/session-message.ts`)
  gains one optional field:
  ```ts
  documentGenerationConfidence?: DocumentGenerationConfidence | null;
  ```
- New `DocumentGenerationConfidence` interface in the same file:
  ```ts
  interface DocumentGenerationConfidence {
    guidanceAlignmentConfidence: number;   // 0-100
    guidanceAlignmentRationale: string;
    criteriaAlignmentConfidence: number;   // 0-100
    criteriaAlignmentRationale: string;
  }
  ```

No other domain entities change. `SessionDocument` keeps the same shape —
the confidence block lives on the message that *owns* the document, not
on `SessionDocument` itself, because the block is generated alongside
the document and is part of the turn record.

## Affected use cases

- `GenerateDocument` (in `packages/application/src/use-cases/document/`):
  - After the document is generated and uploaded, a new LLM call grades
    the produced document against (a) the flow context docs and
    (b) the node's completion criteria, returning a
    `DocumentGenerationConfidence` block.
  - The use-case writes the block back to the owning message via a new
    repository method `updateAiPayload(messageId, payload)` (additive —
    no existing call site changes).
  - The grader call is best-effort: a failure logs an error and skips
    the payload update; document generation itself still succeeds.

## DB changes

**None.** `ai_payload` on `core_session_messages` is already a `jsonb`
column. Older rows simply lack the new field; the UI handles that case
by hiding the icon.

## API / UI changes

### Schemas (`packages/shared/src/schemas/`)

- `confidence.ts` gains `documentGenerationConfidenceSchema`:
  ```ts
  export const documentGenerationConfidenceSchema = z.object({
    guidanceAlignmentConfidence: z.number().int().min(0).max(100),
    guidanceAlignmentRationale: z.string(),
    criteriaAlignmentConfidence: z.number().int().min(0).max(100),
    criteriaAlignmentRationale: z.string(),
  });
  ```

### Application layer (`packages/application/`)

- `GenerateDocument.execute` gains a final step: build a grading prompt
  that includes the rendered document field values, the flow's
  `contextDocs` (extracted text), and the node's `completionCriteria`,
  then call `languageModel.generateObject` against the new schema.
- New helper in the use-case (private) `gradeDocumentAlignment(...)`
  that returns `Result<DocumentGenerationConfidence>` so an error path
  does not surface a thrown exception.
- New repository method on `ISessionMessageRepository`:
  ```ts
  updateAiPayload(id: string, payload: AiTurnPayload): Promise<Result<void>>;
  ```
  Implemented in `packages/adapters/src/db/repositories/session-messages.ts`
  as a single `UPDATE … SET ai_payload = $1 WHERE id = $2`.

### UI (`apps/web/src/components/chat/`)

- New `message-info-modal.tsx`:
  - Receives `{ message: SessionMessage, allMessages: SessionMessage[] }`.
  - Renders a `<Dialog>` with `<DialogHeader>` ("Why this response"),
    a body that shows the turn's `rationale` and a re-used
    `<ConfidenceBar>` for `message.confidence`, and a
    `<details>` block titled "Insights gathered so far".
  - Inside `<details>`, renders a `<dl>` of `{ key, value }` rows
    built by a pure helper `accumulateInsights(allMessages)` that
    walks every assistant message's `aiPayload.contextGathered` in
    chronological order and keeps the latest value per key.
- New `document-info-modal.tsx`:
  - Receives `{ confidence: DocumentGenerationConfidence }`.
  - Renders two stacked rows; each row has a `<ConfidenceBar>` and a
    short rationale paragraph below it. Labels: "Alignment to flow
    guidance" and "Alignment to step criteria".
- `message-feed.tsx`:
  - Adds the `<Info>` icon button (Lucide `Info`, 12px,
    `text-[#918d87] hover:text-[#5a5650]`) absolutely positioned in
    the bottom-right of the assistant message bubble. Visible when
    `msg.role === "assistant"` and `msg.aiPayload !== null`.
  - Renders `<MessageInfoModal>` triggered by that button. The modal
    receives `dbMessages` so it can compute accumulated insights.
- `document-card.tsx`:
  - Adds the `<Info>` icon button in the top-right of the card.
    Visible when the owning message's
    `aiPayload?.documentGenerationConfidence` exists. The component
    receives the confidence block as a new optional prop
    `documentGenerationConfidence?: DocumentGenerationConfidence`.
    `message-feed.tsx` reads it from the milestone message and
    passes it down.

### Helpers (`packages/application/src/services/`)

- New pure helper `accumulate-insights.ts`:
  ```ts
  export function accumulateInsights(messages: SessionMessage[]):
    { key: string; value: string }[];
  ```
  - Iterates the messages in order, collecting `aiPayload.contextGathered`
    entries from assistant messages, last-write-wins on duplicate keys,
    preserves first-seen ordering of keys.
  - Unit tested in isolation. Reused by `<MessageInfoModal>` (re-exported
    through `@rbrasier/application` so the web app does not reach into
    domain itself for logic).

## Why not put the doc confidence on `SessionDocument`

The grading is a turn-time AI artifact, not a property of the file
itself. The same file could later be re-graded against a refreshed set
of guidance docs and produce a different number; conceptually it
belongs with the message's `aiPayload` (which is *the* per-turn AI
record), and keeping it there avoids touching `SessionDocument`'s
shape, the documents API route, or the `MilestonePill`.

## Why a `<details>` element, not a custom collapsible

The insights section is the only collapsible in the modal, the
default browser behaviour is fine, and adding a Radix `Collapsible`
or a custom hook would be more code than it saves. Existing dialogs
in the repo don't use a custom collapsible primitive, so adopting
`<details>` keeps the dependency surface unchanged.

## Acceptance criteria

- [ ] An assistant message with a populated `aiPayload` renders an
      `Info` icon in its bottom-right corner; clicking opens a modal
      whose header reads "Why this response", whose body shows the
      `rationale` string verbatim, and whose closed `<details>`
      titled "Insights gathered so far" expands to a `<dl>` of the
      accumulated `{ key, value }` pairs.
- [ ] An assistant message with `aiPayload === null` (greeting rows,
      historical pre-1.15.0 rows) renders **no** `Info` icon.
- [ ] User-role messages render no `Info` icon under any condition.
- [ ] The accumulated insights helper deduplicates by `key`, keeps the
      most recent value, and preserves the chronological order in
      which each key was first seen (unit-tested in isolation).
- [ ] After a step with `output_type='generate_document'` advances
      and the document has been written, the message's `aiPayload`
      contains a `documentGenerationConfidence` block with both
      confidence integers in `[0, 100]` and both rationale strings
      non-empty.
- [ ] The `<DocumentCard>` on a message that carries that block
      renders an `Info` icon in its top-right corner; clicking opens
      a modal with two `<ConfidenceBar>` rows labelled "Alignment to
      flow guidance" and "Alignment to step criteria", each followed
      by its rationale paragraph.
- [ ] A `<DocumentCard>` on a message without the block (historical
      documents) renders no `Info` icon, and `<MessageInfoModal>`
      still works on the same message.
- [ ] If the grader LLM call inside `GenerateDocument` fails, the
      document is still saved and downloadable; the failure is
      logged via `errorLogger`; the icon on the document card is
      hidden because no block was persisted.
- [ ] `./validate.sh` passes; `VERSION` and root `package.json#version`
      both read `1.15.0`.

## Risks / open questions

- **Extra LLM call adds latency and cost to document generation.**
  The grader runs after the docx is uploaded, so it does not delay
  the user seeing the file in the card, but the
  `documentGenerationConfidence` block is written asynchronously and
  the modal will read "—" until it lands. Mitigation: keep the
  grader prompt short (only the rendered field values + criteria
  text, not the full transcript); use the cheap branching/title
  model, not the chat model.
- **Grader may hallucinate confidence numbers.** The rationale is the
  user-facing artifact; the number is supporting. Mitigation:
  schema validation clamps to `[0, 100]`; the rationale is rendered
  prominently next to the bar so a confused number is contextually
  visible.
- **Insights ledger could leak sensitive values into the modal.**
  All `contextGathered` values are already persisted in the database
  and shown to the user implicitly via the agent's prose. Surfacing
  them in a per-flow ledger is the same trust boundary; no new
  exposure.
- **Historical messages have no rationale.** Intentional — the icon
  is hidden when `aiPayload` is null. Users on long-lived sessions
  will see the icon appear only on new turns after the upgrade.

## Version

MINOR — **1.15.0**. New user-visible feature; `AiTurnPayload` shape
gains an optional field but `ai_payload` is JSON so no migration is
required. Older rows render with the icon hidden.
