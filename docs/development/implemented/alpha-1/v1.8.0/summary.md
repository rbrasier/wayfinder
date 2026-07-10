# v1.8.0 — UI Polish, Edit/Configure Split, Share/Collaborate

## Why

A batch of user-reported UX gaps and small bugs. Most touch flow management,
chat-session sharing, and config-step authoring. One item — admin auto-redirect
on the homepage — was the cause of an "edit-as-admin lands in admin area"
report. Another — token usage missing from `/admin/usage` — turned out to be a
wiring bug: the chat-stream route called the Vercel AI SDK directly, bypassing
the `UsageTrackingAdapter` that the rest of the codebase routes through.

## What changed

### Sidebar
- `apps/web/src/components/sidebar.tsx` — User sidebar now shows
  **Recent Chats** sourced from `session.list` (sorted desc by `updatedAt`,
  capped at 8). Admin sidebar no longer renders a flow/chat list. Mobile
  drawer mirrors the desktop layout.
- `apps/web/src/app/(user)/layout.tsx` — Prefetches `session.list` alongside
  the existing `session.listPublishedFlows`.

### Admin auto-redirect (item 4)
- `apps/web/src/app/(user)/page.tsx` — Removed the `session.isAdmin` branch
  that redirected admins to `/admin/flows`. All authenticated users now land
  on `/chats`. Admin mode is entered only via the explicit "Enter admin mode"
  button in the sidebar.

### Token usage tracking (item 2)
- `packages/adapters/src/observability/usage-tracking-adapter.ts` — Renamed
  the internal `record` helper to **`recordTokenUsage`** and exported it.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — Calls
  `recordTokenUsage` after each of the three AI calls (chat turn, branch
  choice, session title). `streamTurn` now resolves with `{ object, usage }`
  so the route can read prompt/completion tokens.
- `apps/web/src/app/api/chat/[sessionId]/stream/stream-turn.ts` — Signature
  change; test updated.

### Node-config modal (item 3, 6)
- `apps/web/src/components/canvas/node-config-modal.tsx`:
  - Added a `useEffect` that resets local form state from `initialValues`
    whenever the modal opens — fixes the "blank fields when editing an
    existing node" bug.
  - Added **`neverDone`** to `NodeConfigValues`. The "Done when…" field is
    now a `<select>` with two options: "Specific condition" (default,
    shows the textarea) and "Never done. User can continue to interact
    indefinitely" (hides the textarea). `neverDone` persists in the node's
    config JSON — no schema change.
- `apps/web/src/components/chat/message-feed.tsx` — Hides `<ConfidenceBar>`
  and the milestone pill for messages whose step is `neverDone`. Streaming
  branch infers `neverDone` from the most recent persisted assistant
  message's step.
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts` — When the current
  node's `neverDone` is true, skips branch-choice and sets
  `advanceThreshold` to `Number.POSITIVE_INFINITY` so the session never
  advances.
- Both canvas pages (`(user)/flows/[id]/config/_content.tsx` and
  `(admin)/admin/flows/[id]/_content.tsx`) now serialise/deserialise
  `neverDone` through `toRfNode`, `handleConfigSave`, and `initialConfigValues`.

### Flow listing row actions (items 5, 8)
- New shared component `apps/web/src/components/flow/flow-metadata-dialog.tsx`
  — same form used by the create modal, parametrised with
  `mode: "create" | "edit"` and `initialValues`.
- New shared component `apps/web/src/components/flow/share-flow-dialog.tsx`
  — small modal with read-only URL field and Copy button. URL shape:
  `${origin}/chats?flow={id}&start=1`.
- `apps/web/src/app/(user)/flows/_content.tsx` and
  `apps/web/src/app/(admin)/admin/flows/_content.tsx`:
  - Renamed the canvas-opening button to **Configure Flow** (primary).
  - Added a white-bg **Edit** button that opens `FlowMetadataDialog` in
    edit mode (uses the existing `flow.update` tRPC procedure).
  - Added a white-bg **Share** button — visible only when
    `flow.status === "published"` — that opens `ShareFlowDialog`.

### Config-canvas top bar (item 7)
- `apps/web/src/app/(user)/flows/[id]/config/_content.tsx`:
  - Removed the inline expert-role text input.
  - Added a top-right **Edit** button that opens `FlowMetadataDialog` in
    edit mode for name/description/role/icon.
  - Removed the unused "Open Chat" disabled button.

### Chat avatars + share/collaborate (items 9, 10)
- `apps/web/src/components/chat/message-feed.tsx` — Bot avatar derives
  initials from `flow.expertRole` (first letter of each whitespace-separated
  token, max 2, uppercase; fallback "AI"). User avatar uses the first
  initial of the viewer's first name (fallback "U").
- `apps/web/src/components/chat/share-button.tsx` — Now parametrised with
  `{ label, url, toastMessage }`.
- `apps/web/src/components/chat/step-progress-rail.tsx` — Accepts an
  optional `rightSlot` ReactNode for trailing actions.
- `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx`:
  - Header keeps a **Share** button — copies a new-chat URL; toast:
    "Link copied — share with a colleague to start a new chat session
    using this flow".
  - The step-progress rail now renders a **Collaborate** button on the
    right; copies the current-session URL with `?shared=true`; toast:
    "Link copied, share it with a colleague to collaborate in this chat
    session".

## Files

**New**
- `apps/web/src/components/flow/flow-metadata-dialog.tsx`
- `apps/web/src/components/flow/share-flow-dialog.tsx`
- `docs/development/implemented/v1.8.0/{phase,summary}.md`

**Modified**
- `apps/web/src/components/sidebar.tsx`
- `apps/web/src/components/canvas/node-config-modal.tsx`
- `apps/web/src/components/chat/message-feed.tsx`
- `apps/web/src/components/chat/share-button.tsx`
- `apps/web/src/components/chat/step-progress-rail.tsx`
- `apps/web/src/app/(user)/page.tsx`
- `apps/web/src/app/(user)/layout.tsx`
- `apps/web/src/app/(user)/flows/_content.tsx`
- `apps/web/src/app/(user)/flows/[id]/config/_content.tsx`
- `apps/web/src/app/(user)/chats/[sessionId]/_content.tsx`
- `apps/web/src/app/(admin)/admin/flows/_content.tsx`
- `apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx`
- `apps/web/src/app/api/chat/[sessionId]/stream/route.ts`
- `apps/web/src/app/api/chat/[sessionId]/stream/stream-turn.ts`
- `apps/web/src/app/api/chat/[sessionId]/stream/stream-turn.test.ts`
- `packages/adapters/src/observability/usage-tracking-adapter.ts`
- `VERSION`, `package.json`

## Migrations

None. `neverDone` rides in the existing `flow_nodes.config` JSON column.

## Known limitations

- Streaming-branch confidence-bar suppression for `neverDone` reads the
  *previous* persisted message's step. In the rare case where the very
  first turn of the session targets a `neverDone` step (no prior assistant
  message), the streaming bar may briefly render before the persisted
  message arrives. The persisted-branch render then correctly hides it.
- The chat title generator runs `generateText` without `experimental_providerMetadata`,
  so its usage rows record `cacheReadTokens` and `cacheWriteTokens` as 0
  (Anthropic cache hits aren't surfaced to the route in this path). Cost
  is still recorded — just at the non-cached rate.
- The "Recent Chats" sidebar uses the existing `session.list`. If a user
  has many sessions, the query returns them all and we slice client-side;
  for the current scale this is fine, but a dedicated `listRecent(limit)`
  endpoint should be added if the list grows large.

## Version

`1.7.5 → 1.8.0` (MINOR — new features, no schema change).
