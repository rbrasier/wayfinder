# PRD — Wayfinder

> Wayfinder is the product name for the AI-guided workflow agent built on this
> monorepo template. The reference deployment targets Australian Government
> procurement workflows grounded in the Commonwealth Procurement Rules (CPR);
> the platform itself is domain-agnostic.

- **Status**: Draft / In Review
- **Date**: 2026-05-19
- **Author**: Solo / Claude Code
- **Target version**: rolled out across `v1.1.0` (Phase 0) → `v1.5.0` (Phase 4). Each phase is MINOR (schema or feature change). See `docs/guides/versioning.md`.

## 1. Problem

In regulated environments, complex multi-step processes (procurement, onboarding,
policy review) are poorly served by generic automation tools (n8n, Zapier) — which
require technical configuration and provide no guided user experience — and by
static forms/checklists, which provide no intelligence, branching logic, or
document generation. End users skip steps, make errors, or need expensive
specialist support for every workflow instance.

## 2. Users / Personas

- **Procurement Officer** — runs procurement workflows end-to-end via the chat
  interface. Needs the AI to ask the right follow-up questions, build confidence,
  and produce the artefacts (RFT, Evaluation Report, Contract Management Plan)
  with minimal rework.
- **Business Analyst / Policy Owner (Flow Owner)** — designs and maintains
  workflow configurations on the canvas. Authors AI instructions, document
  templates, and uploads context documents (CPR summary, delegation registers,
  policy summaries).
- **Admin** — manages users, flows, and sessions across the organisation. Can
  assign flow ownership and view all sessions for oversight.

## 3. Goals

- A user can complete an end-to-end Australian Government procurement session
  (Identify Need → AusTender) in under 20 minutes via natural conversation.
- An admin or flow owner can configure a 5-step flow from scratch on the canvas
  in under 30 minutes — no code, no JSON editing.
- Steps with a document template generate a download-ready DOCX automatically
  when confidence ≥ 90 and the AI signals `readyToAdvance`.
- A shared session URL is viewable read-only by any authenticated user with the
  link.
- Magic-link login works against the existing `AUTH_METHOD=magic-link` config
  (no new auth code required for MVP).
- AU Gov procurement flow (7 nodes, 5 compliance branches, 3 document templates,
  3 context documents) is seeded into a fresh install and runs end-to-end.

## 4. Non-goals

- No autonomous "auto-node" execution at MVP — deferred to Phase 5.
- No n8n sub-workflow integration at MVP — the `INodeExecutor` port ships with
  a `MockNodeExecutor` only. Real n8n adapter is Phase 5.
- No PDF output, no real-time collaborative session editing, no email
  notifications, no flow versioning, no analytics dashboard at MVP — all listed
  in Section 11.
- No new authentication code paths. MVP reuses `AUTH_METHOD=magic-link` from
  v0.5.0. PKI/SAML/Entra mapping is Phase 6.
- No mobile-optimised canvas — canvas is desktop-only and documented as such.

## 5. Key entities

| Entity            | Lives in                                              | New / existing | Notes |
| ----------------- | ----------------------------------------------------- | -------------- | ----- |
| Flow              | `packages/domain/src/entities/flow.ts`                | new            | name, description, icon, owner, published |
| FlowNode          | `packages/domain/src/entities/flow-node.ts`           | new            | type (`conversational` MVP), position, JSON config |
| FlowEdge          | `packages/domain/src/entities/flow-edge.ts`           | new            | directed, from/to node ids |
| Session           | `packages/domain/src/entities/session.ts`             | new            | flow_id, user_id, status, current_node_id |
| Message           | reuses `ai_messages` pattern                          | new table      | session_id, role, content, confidence, step, created_at |
| Document          | `packages/domain/src/entities/document.ts`            | new            | session_id, node_id, filename, storage_path |
| FlowPermission    | `packages/domain/src/entities/flow-permission.ts`     | new            | user_id, flow_id, permission (`owner`/`viewer`) |
| INodeExecutor port| `packages/domain/src/ports/node-executor.ts`          | new            | `MockNodeExecutor` MVP; `N8nNodeExecutor` Phase 5 |
| FlowSessionGraph  | `packages/adapters/src/agents/flow-session-graph.ts`  | new            | LangGraph instance per session, extends ADR-004 |
| DocumentGeneration| `packages/adapters/src/documents/docx-generator.ts`   | new            | docx-js implementation behind `IDocumentGenerator` port |

All new tables use the `app_` prefix (Wayfinder is the application built on the
template, not core or AI infrastructure). Columns are snake_case. Every table has
`id` (uuid), `created_at`, `updated_at`.

## 6. User stories

1. As a **procurement officer**, I open Wayfinder, see a list of my active and
   completed sessions, search by title, and resume an in-progress procurement.
2. As a **procurement officer**, I click "New Chat", pick the procurement flow
   from a modal of published flows, and start a guided conversation that ends
   with a downloadable RFT.
3. As a **flow owner**, I open my flow on the canvas, drag from a node's right
   handle to a blank area to create a new step, configure its AI instruction and
   done-when criteria, optionally attach a Markdown document template, and save.
4. As a **flow owner**, I upload context documents (CPR summary, delegation
   register) to the flow so the AI cites them during every session.
5. As an **admin**, I view every session in the organisation, filter by user and
   flow, and assign a colleague as owner of a flow they didn't create.
6. As a **procurement officer**, I click "Share" on a session and copy a URL
   that any authenticated colleague can open in read-only mode.

## 7. Pages / surfaces affected

### User surface (`(user)/*` route group)

- `/chats` — session listing (NEW). Active / Completed / All tabs, search,
  filter, "New Chat" modal. Replaces the existing `/` placeholder for
  authenticated users.
- `/chats/[sessionId]` — chat interface (NEW). Header with flow name, status
  badge, Share button. Step progress rail. Message feed with confidence bars,
  milestone pills, document cards. Auto-resize textarea input.
- `/chats/[sessionId]?shared=true` — read-only shared view (NEW).
- `/flows/[id]/config` — canvas builder for flow owners (NEW). Same canvas as
  admin, scoped by `flow_permissions`.

### Admin surface (`(admin)/*` route group)

- `/admin/flows` — flow listing (NEW). Name, description, status, owner, edit.
  "New Flow" modal.
- `/admin/flows/[id]` — canvas (NEW). React Flow surface, node config modal,
  context document uploader, Save Draft / Publish.
- `/admin/sessions` — admin view of all sessions across users (NEW).

### Existing admin pages (untouched)

- `/admin`, `/admin/users`, `/admin/errors`, `/admin/usage`, `/admin/settings`,
  `/admin/flags`, `/admin/login` — remain unchanged.

### API surfaces

- `apps/web` — tRPC routers: `flow.*` (list, get, create, update, publish,
  uploadContextDoc, assignOwner), `session.*` (list, get, create, message,
  share), `document.*` (download).
- `apps/web` — Next.js streaming route `/api/chat/[sessionId]/stream` for the
  AI turn (`useChat` + `streamText`/`streamObject`).
- `apps/api` (Express) — `POST /v1/webhooks/n8n/:sessionId` (Phase 5, stubbed at
  MVP). Shared-secret authenticated.

## 8. Database changes

| Table                  | Change                                                          | Prefix valid? |
| ---------------------- | --------------------------------------------------------------- | ------------- |
| `app_flows`            | NEW — id, name, description, icon, owner_user_id, status (`draft`/`published`), created_at, updated_at | yes (app_) |
| `app_flow_nodes`       | NEW — id, flow_id, type, name, colour, position_x, position_y, config jsonb, created_at, updated_at | yes |
| `app_flow_edges`       | NEW — id, flow_id, from_node_id, to_node_id, created_at | yes |
| `app_flow_context_docs`| NEW — id, flow_id, filename, mime_type, size_bytes, storage_path, created_at | yes |
| `app_flow_permissions` | NEW — id, flow_id, user_id, permission (`owner`/`viewer`), created_at | yes |
| `app_sessions`         | NEW — id, flow_id, user_id, status (`active`/`complete`/`abandoned`), title, current_node_id, graph_checkpoint jsonb, created_at, updated_at | yes |
| `app_session_messages` | NEW — id, session_id, role (`user`/`assistant`/`system`), content, confidence smallint, step_node_id, created_at | yes |
| `app_documents`        | NEW — id, session_id, node_id, filename, storage_path, summary, generated_at, created_at, updated_at | yes |

All in the `app_` group (Wayfinder is the application built on the template).
`ai_conversations` and `ai_messages` from v0.1 remain for the `/sample` demo and
are not reused for session messages — sessions have a richer schema
(`step_node_id`, `confidence`).

## 9. Architectural decisions

### Existing ADRs assumed

- **ADR-001 Hexagonal Architecture** — all ports live in `packages/domain`;
  Wayfinder ports (`INodeExecutor`, `IDocumentGenerator`) follow the same shape.
- **ADR-002 Multi-Provider AI** — Wayfinder uses the existing `ILanguageModel`
  port; default provider `anthropic`, default model
  `claude-sonnet-4-20250514` for conversation, `claude-haiku-4-5-20251001` for
  confidence scoring (cost-driven choice).
- **ADR-003 Monorepo Structure** — `apps/web` for Next.js + tRPC, `apps/api` for
  Express webhooks; framework code stays in `@rbrasier/*` npm deps.
- **ADR-004 LangGraph as Adapter** — extended (not replaced) by ADR-007.

### New ADRs introduced by this PRD

- **ADR-005 Two-Surface Route Groups & Role Model** — `(user)` and `(admin)`
  route groups; `admin`/`user` global roles plus per-flow `owner` permission in
  `app_flow_permissions`.
- **ADR-006 Wayfinder Schema** — table list above; node config as `jsonb`.
- **ADR-007 Session-Scoped LangGraph** — one `FlowSessionGraph` per session,
  built from the flow config at session start, checkpointed to Postgres.
- **ADR-008 Canvas Builder on React Flow** — `@xyflow/react` as the canvas
  library; custom `ConversationalNode` component.
- **ADR-009 Document Generation: docx-js + Markdown Templates** — server-side
  generation, `/tmp` storage at MVP, documented limitation.
- **ADR-010 External Workflow Integration via INodeExecutor** — port shape
  includes `userId` / `userRole` from day one; `MockNodeExecutor` ships at MVP,
  `N8nNodeExecutor` is Phase 5. Express webhook receiver lives in `apps/api`.
- **ADR-011 Functional Source Licence** — adopted for the Wayfinder
  repository, matching n8n. Converts to Apache 2.0 after 2 years.

## 10. Acceptance criteria

These are the testable outcomes used by `/doc-review` and as the test plan
during `/build`. Each phase doc references the subset it satisfies.

- [ ] `AUTH_METHOD=magic-link` (default in `.env.example`) signs in a user; the
      JWT claim includes `role: 'admin' | 'user'`.
- [ ] An admin who navigates to `/admin/flows` sees the seeded AU Gov
      procurement flow with status `published`.
- [ ] An admin opens the canvas (`/admin/flows/[id]`), drags a node, configures
      its AI instruction and done-when, saves, and the changes survive a page
      refresh.
- [ ] A user starts a new session via the "New Chat" modal on `/chats`, picks
      the procurement flow, and lands on `/chats/[sessionId]` with the
      first-node prompt streamed in.
- [ ] After each user message, the confidence indicator under the agent reply
      reflects the structured `confidence.score` (0–100) returned alongside the
      streamed text.
- [ ] When confidence ≥ 90 and `readyToAdvance` is true, the step badge in the
      progress rail flips to complete (green checkmark) and the next node's
      prompt streams in.
- [ ] When a step with `output_type='generate_document'` completes, a document
      card renders inline with a Download button that delivers a DOCX file
      named `[FlowName]-[NodeName]-[SessionId]-[Date].docx`.
- [ ] An admin viewing `/admin/sessions` sees every session in the
      organisation; user badges (name + initials) appear on each card.
- [ ] Sharing a session URL copies `[base_url]/chats/[sessionId]?shared=true`;
      a different authenticated user opening that URL sees the conversation
      read-only with the input area replaced by a notice.
- [ ] Session state survives a browser refresh: `currentNodeId`, messages,
      confidence, and document cards all re-render from the database.
- [ ] An admin uploads a PDF context document on the canvas; the AI references
      the document content in subsequent session turns (visible in Langfuse
      traces).
- [ ] Page-load: session list renders in under 1 second for up to 200 sessions
      per user.
- [ ] Streaming: agent response begins within 2 seconds of the user pressing
      Send.
- [ ] Canvas: 20-node flow renders and remains interactive without visible
      degradation (no dropped frames during drag).
- [ ] `./validate.sh` passes after every phase. `VERSION` and root
      `package.json#version` match at each phase's target version.

## 11. Out of scope / future work

Captured to prevent scope creep — these are deliberately deferred.

| Feature                                                | Phase   |
| ------------------------------------------------------ | ------- |
| Auto Node type (autonomous, no human input)            | Phase 5 |
| n8n sub-workflow integration (`N8nNodeExecutor`)       | Phase 5 |
| Approval gate UI for auto nodes with write actions     | Phase 5 |
| PKI / SAML / Entra ID role mapping for FlowAgent roles | Phase 6 |
| PDF document output (currently DOCX-only)              | Phase 6+ |
| Real-time collaborative session editing                | Phase 6+ |
| Email notifications (step complete, session shared)    | Phase 6+ |
| Flow versioning / change history                       | Phase 6+ |
| Analytics dashboard (volumes, completion rates)        | Phase 7+ |
| Mobile-optimised canvas                                | Phase 7+ |
| Multi-language support                                 | Phase 7+ |
| Multi-agent autonomous canvas (Relevance AI pattern)   | Phase 7+ |

## 12. Risks / open questions

- **LangGraph checkpoint size** — message history + gathered context can grow
  large for long sessions. Mitigation: store full message history in
  `app_session_messages` and only the agent state (`currentNodeId`,
  `gatheredContext`) in `graph_checkpoint`.
- **Confidence scoring latency** — a parallel `streamObject` call adds latency
  per turn. Mitigation: run conversation `streamText` and confidence
  `streamObject` in parallel; render text immediately, update confidence when it
  resolves.
- **`/tmp` document storage lost on restart** — documented limitation. Document
  rows in `app_documents` reference `storage_path`; on missing file the
  download endpoint returns 410 with a "regenerate" hint. Phase 4 considers
  durable storage.
- **Drag-to-connect on React Flow with custom node** — handle position and
  pointer-events must be carefully styled to avoid orphaned edges. Risk
  addressed in Phase 1b acceptance criteria.
- **`docx-js` table rendering** — Markdown tables require explicit conversion
  to `docx.Table`. Phase 3 templates avoid tables in v1 (use headed sections
  with bullet lists); table support is a Phase 4 polish item if needed.
- **n8n payload contract stability** — including `userId` / `userRole` in
  `NodeExecutionInput` from day one (ADR-010) prevents Phase 5 from being a
  breaking change. Open question: do we also include `sessionTitle` and
  `flowSlug` for n8n side-effect attribution? Default yes; revisit at Phase 5.
- **Multi-tenancy** — MVP assumes a single organisation per deployment. If a
  hosted-multi-tenant deployment is later proposed, an `organisation_id` column
  will need to be back-filled across all `app_*` tables. Out of scope for now.
