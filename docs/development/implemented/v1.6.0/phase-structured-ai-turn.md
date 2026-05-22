# Phase — Structured AI Turn & Prompt Restructure

- **Status**: Awaiting Implementation
- **Target version**: `1.6.0` (bump: MINOR — new DB columns, new table, changed AI call shape)
- **Depends on**: v1.5.7 (current head)

## 1. Problem

The current flow step system prompt is a flat markdown document with no
persona, no XML structure, and no constraints block. The AI returns free-form
text, requiring a separate (parallel) model call on every turn solely to
assess completion confidence and branch routing. Context gathered during a
step is never accumulated or threaded back into subsequent turns.

## 2. Goals

- Restructure the conversational system prompt into XML sections with a
  persona derived from flow-level `expertRole` and the flow name.
- Collapse the two parallel AI calls (text stream + confidence object) into a
  single structured-JSON call that returns the response, rationale, confidence
  score, and accumulated context in one round-trip.
- Branch choice becomes a separate lightweight call, only triggered once
  `stepCompleteConfidence >= 90`.
- Document generation (when `outputType === "generate_document"`) uses a
  higher-quality Sonnet-class model, triggered after step completion.
- Persist the full AI JSON payload on each assistant message row so context
  accumulates across turns.
- Introduce a system-wide `organisationName` setting (admin-configurable);
  omit the organisation clause from the prompt when unset.

## 3. Non-goals

- Document content extraction / RAG (covered by the context document extraction phase).
- Admin UI for managing system settings (the setting is written directly to DB
  in this phase; UI is a separate task).
- Changes to the document generation prompt or logic beyond model selection.

## 4. Revised prompt structure

### 4a. Conversational system prompt

```xml
<role>
  You are a world-class {expertRole} with over 20 years of experience
  [at {organisationName} — omit entire clause if organisationName is null].
  You understand its processes, culture, and requirements intimately.
  You are currently helping a colleague complete the "{workflowName}" workflow,
  guiding them through it step by step. Stay focused on this step only —
  do not anticipate future steps.
</role>

<instructions>
  {nodeConfig.aiInstruction}
</instructions>

<context>
  [if gatheredContext non-empty:]
  <gathered_context>
    {gatheredContext — serialised from previous turns' contextGathered arrays}
    You may ask nuanced follow-up questions to clarify or deepen anything
    captured here if it would help complete this step more accurately.
  </gathered_context>

  [if contextDocs non-empty:]
  <reference_documents>
    - {filename}
    ...
    Consult these when the user's question touches on policy or process.
  </reference_documents>
</context>

<goal>
  Your goal is to gather enough information to reach 90% confidence or above
  that the <completion_criteria> below has been fully satisfied. Continue
  asking questions until you are confident the criteria has been met.

  <completion_criteria>{nodeConfig.doneWhen}</completion_criteria>

  [if nodeConfig.outputType === "generate_document" and documentTemplateMarkdown non-null:]
  <document_template>
    This step produces a document. Your goal is to gather all information
    needed to fully complete the following template:
    {nodeConfig.documentTemplateMarkdown}
  </document_template>
</goal>

<constraints>
  - Ask one question at a time — wait for the answer before continuing
  - Be plain-spoken — no jargon or technical terms
  - Do not discuss future steps
  - Do not re-ask for information already in gathered_context unless
    clarification would meaningfully improve the output
  - If the user goes off-topic, gently redirect them back to this step
</constraints>

<output>
  Respond only with valid JSON in this exact structure — no prose outside it:

  {
    "response": "Your conversational reply to the user",
    "rationale": "Why you are asking this or why the step is complete",
    "stepCompleteConfidence": 0-100,
    "contextGathered": [
      { "key": "descriptive label", "value": "what the user provided" }
    ]
  }
</output>
```

### 4b. Branch choice prompt (post-completion only)

Called only when `stepCompleteConfidence >= 90`. Separate `generateObject`
call on a cheap model.

```
Based on the conversation below, select the most appropriate next step.

Available branches:
- {nodeId} ({nodeName})
- ...

Return only: { "branchChoice": "<nodeId>" }
```

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| domain | `packages/domain/src/entities/flow.ts` | Add `expertRole: string \| null` to `Flow` and `NewFlow` |
| domain | `packages/domain/src/entities/session-message.ts` | Add `aiPayload: AiTurnPayload \| null` to `SessionMessage`; add `AiTurnPayload` type |
| domain | `packages/domain/src/entities/system-setting.ts` | New entity: `SystemSetting` |
| domain | `packages/domain/src/ports/session-agent.ts` | Update `BuildSystemPromptInput`; remove `BuildConfidencePromptInput`; add `BuildBranchChoicePromptInput` |
| domain | `packages/domain/src/ports/system-settings-repository.ts` | New port: `ISystemSettingsRepository` |
| domain | `packages/domain/src/index.ts` | Export new types/ports |
| shared | `packages/shared/src/schemas/confidence.ts` | Add `turnResponseSchema`; add `branchChoiceSchema`; keep `turnSchema` as alias or remove |
| adapters | `packages/adapters/src/agents/flow-session-graph.ts` | Rewrite `buildSystemPrompt`; remove `buildConfidenceSystemPrompt`; add `buildBranchChoicePrompt` |
| adapters | `packages/adapters/src/db/schema/wayfinder.ts` | Add `expert_role` to `app_flows`; add `ai_payload` JSONB to `app_session_messages`; new `admin_system_settings` table |
| adapters | `packages/adapters/src/repositories/drizzle-flow-repository.ts` | Map `expert_role` |
| adapters | `packages/adapters/src/repositories/drizzle-session-message-repository.ts` | Map `ai_payload` |
| adapters | `packages/adapters/src/repositories/drizzle-system-settings-repository.ts` | New repository |
| apps/web | `apps/web/src/lib/container.ts` | Register `systemSettingsRepository`; wire into use cases |
| apps/web | `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` | Replace two parallel calls with single `streamObject`; add branch choice call; fetch `organisationName` |
| apps/web | `apps/web/src/server/routers/flow.ts` | Update `node.previewPrompt` to pass new fields |
| apps/web | `apps/web/src/components/canvas/node-config-modal.tsx` | No new step fields (expertRole moves to flow level) |
| apps/web | `apps/web/src/components/` | Flow edit UI: add `expertRole` input field |

## 6. Domain changes

### `Flow` and `NewFlow`

```ts
export interface Flow {
  // ... existing fields
  expertRole: string | null; // NEW
}

export interface NewFlow {
  // ... existing fields
  expertRole?: string | null; // NEW
}
```

### `AiTurnPayload` and `SessionMessage`

```ts
export interface AiTurnPayload {
  response: string;
  rationale: string;
  stepCompleteConfidence: number;
  contextGathered: { key: string; value: string }[];
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  confidence: number | null;
  stepNodeId: string | null;
  document: SessionDocument | null;
  aiPayload: AiTurnPayload | null; // NEW — populated for assistant messages only
  createdAt: Date;
}
```

### `SystemSetting` (new entity)

```ts
export interface SystemSetting {
  key: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### `ISystemSettingsRepository` (new port)

```ts
export interface ISystemSettingsRepository {
  get(key: string): Promise<Result<SystemSetting | null>>;
  set(key: string, value: string): Promise<Result<SystemSetting>>;
}
```

### Updated `BuildSystemPromptInput`

```ts
export interface BuildSystemPromptInput {
  nodeConfig: ConversationalNodeConfig;
  contextDocs: FlowContextDoc[];
  gatheredContext: string;       // serialised from prior turns
  workflowName: string;          // NEW — flow.name
  organisationName: string | null; // NEW — from system settings, null if unset
  expertRole: string | null;     // NEW — flow.expertRole
}

export interface BuildBranchChoicePromptInput { // NEW
  branchNodes: { id: string; name: string }[];
}
```

`BuildConfidencePromptInput` and `buildConfidenceSystemPrompt` are removed.

## 7. Shared schema changes

In `packages/shared/src/schemas/confidence.ts`:

```ts
// NEW — main turn structured response
export const turnResponseSchema = z.object({
  response: z.string(),
  rationale: z.string(),
  stepCompleteConfidence: z.number().int().min(0).max(100),
  contextGathered: z.array(
    z.object({ key: z.string(), value: z.string() })
  ),
});

// NEW — post-completion branch selection
export const branchChoiceSchema = z.object({
  branchChoice: z.string().describe("Node ID of the chosen next step"),
});

export type TurnResponse = z.infer<typeof turnResponseSchema>;
export type BranchChoice = z.infer<typeof branchChoiceSchema>;
```

The existing `confidenceSchema` / `turnSchema` types are removed. Update all
imports. Verify with `grep -r "turnSchema\|confidenceSchema"` before deleting.

## 8. Database changes

### `app_flows` — add column

```sql
ALTER TABLE app_flows ADD COLUMN expert_role text;
```

Nullable. No default required.

### `app_session_messages` — add column

```sql
ALTER TABLE app_session_messages ADD COLUMN ai_payload jsonb;
```

Nullable. Populated only for `role = 'assistant'` rows.

The existing `confidence` smallint column is kept — it continues to be
populated from `aiPayload.stepCompleteConfidence` for fast queries without
parsing JSONB.

### New table: `admin_system_settings`

```sql
CREATE TABLE admin_system_settings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        text NOT NULL UNIQUE,
  value      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Well-known key for this phase: `"organisation_name"`.

## 9. Stream route changes (`apps/web/src/app/api/chat/[sessionId]/stream/route.ts`)

Replace the current two-call pattern with:

```
Call 1 (every turn) — cheap model (Haiku):
  streamObject({
    model: haikuModel,
    schema: turnResponseSchema,
    system: systemPromptResult.data,
    messages: messagesWithNew,
  })
  → { response, rationale, stepCompleteConfidence, contextGathered }

  Stream `response` field text to client.
  Store full payload as ai_payload on the assistant message row.
  Populate confidence column from stepCompleteConfidence.

Call 2 (only if stepCompleteConfidence >= 90 AND outgoingEdges.length > 1):
  generateObject({
    model: haikuModel,
    schema: branchChoiceSchema,
    system: buildBranchChoicePrompt({ branchNodes }),
    messages: messagesWithNew,
  })
  → { branchChoice }

Call 3 (only if step advanced AND outputType === "generate_document"):
  Existing generateDocument() — model upgraded to Sonnet.
  No other changes to this call.
```

Pre-turn: fetch `organisationName` from `systemSettingsRepository.get("organisation_name")`.
Pre-turn: reconstruct `gatheredContext` by aggregating `aiPayload.contextGathered`
arrays from all previous assistant messages for `stepNodeId === session.currentNodeId`.
Serialise as:
```
- {key}: {value}
- {key}: {value}
```

## 10. `runTurn` use case interface changes

`runTurn.execute` currently receives `confidence: ConfidenceReading`. Update
to receive `aiPayload: AiTurnPayload` and `branchChoice: string | null`
separately. The use case stores `aiPayload` on the assistant message row and
reads `aiPayload.stepCompleteConfidence` in place of `confidence.score`.

Verify the exact `runTurn` interface and implementation before editing.

## 11. Flow UI — `expertRole` field

Add an `expertRole` text input to the flow settings/edit page (wherever
`flow.name` and `flow.description` are edited). Label: "Expert role".
Placeholder: e.g. "procurement specialist". Optional field — leaving it blank
is valid and results in a simplified `<role>` block that omits the expert
framing.

When `expertRole` is blank in the prompt, simplify the `<role>` block to:
```
You are an AI assistant helping a colleague complete the "{workflowName}"
workflow, guiding them through it step by step. Stay focused on this step
only — do not anticipate future steps.
```

## 12. Preview prompt update

The `node.previewPrompt` tRPC query in `apps/web/src/server/routers/flow.ts`
must be updated to:
- Accept no change to its input shape (aiInstruction + doneWhen are still the
  only preview-time variables).
- Fetch `flow.expertRole`, `flow.name`, and `organisationName` from the system
  settings repository and pass them to `buildSystemPrompt`.

## 13. Model assignments

| Call | Model |
|------|-------|
| Main turn (response + contextGathered + confidence) | Haiku |
| Branch choice (post-completion, multi-branch only) | Haiku |
| Document generation | Sonnet (upgrade from current) |
| Session title generation | Haiku (no change) |

## 14. Acceptance criteria

- [ ] System prompt uses XML structure with `<role>`, `<instructions>`,
      `<context>`, `<goal>`, `<constraints>`, `<output>` sections.
- [ ] `<role>` block includes `expertRole` when set on the flow; uses fallback
      plain text when not set.
- [ ] `"at {organisationName}"` clause present when `organisation_name` system
      setting is set; absent when unset.
- [ ] Main turn call returns structured JSON via `streamObject`; `response`
      field text is streamed to the client.
- [ ] Branch choice call fires only when `stepCompleteConfidence >= 90` AND
      there are multiple outgoing edges.
- [ ] Branch choice call does NOT fire for single-edge (linear) steps.
- [ ] `ai_payload` JSONB column populated on every assistant message row.
- [ ] `gatheredContext` in the prompt on turn N contains `contextGathered`
      entries from all previous turns on the same step node.
- [ ] `<document_template>` section appears in the prompt when
      `outputType === "generate_document"` and `documentTemplateMarkdown` is set.
- [ ] Document generation uses Sonnet-class model.
- [ ] `admin_system_settings` table exists; `organisation_name` key can be
      inserted and read.
- [ ] Flow edit UI includes `expertRole` input.
- [ ] `node.previewPrompt` reflects the new prompt structure.
- [ ] `validate.sh` passes.
- [ ] `VERSION` and `package.json#version` = `1.6.0`.

## 15. Validation

Run `./validate.sh`. Then move this file to
`docs/development/implemented/v1.6.0/` and write `summary.md`.
