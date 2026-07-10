# Phase — UI Polish, Edit/Configure Split, Share/Collaborate

- **Status**: Awaiting Implementation
- **Target version**: `1.8.0` (bump: MINOR — new features, sidebar redesign, new tRPC procedures, modal reuse)
- **Depends on**: v1.7.5

## 1. Problem

A batch of UI/UX gaps and small bugs reported by the user:

1. Sidebar lists "My Flows" in user mode and duplicates a flow list in admin mode. The user wants a "Recent Chats" list in user mode and the flow list removed from the admin sidebar.
2. Token usage rows are not appearing under `/admin/usage` even though Anthropic calls are happening. The usage adapter may not be wired into the AI service factory.
3. Clicking a node on `/flows/[id]/config` or `/admin/flows/[id]` opens the configure-step modal with blank fields instead of the node's current values.
4. Editing a flow as an admin redirects to the admin area even when the user has not pressed "Enter admin mode". Admin mode should only be active after that explicit action.
5. The flow row action "Edit" actually opens the canvas configurator. A separate, lightweight "Edit" (rename/description/role/icon) is missing.
6. The configure-step modal lacks a way to mark a step as "never done" — i.e. the user can interact with the assistant indefinitely with no advancement condition.
7. `/flows/[id]/config` shows an inline expert-role text input at the top of the canvas and has no obvious entry point to edit flow metadata.
8. There is no way to share a published flow as a link that opens a fresh chat.
9. Chat avatars hardcode "FA" (bot) and "U" (user). They should reflect the expert role and the user's first name.
10. The Share button in `/chats/[id]` only supports the "collaborate on this session" use case. A second link — start a new chat using the same flow — is needed.

## 2. Goals

- A working "Recent Chats" sidebar for users; clean admin sidebar.
- Token usage persisted for every Anthropic call and visible in `/admin/usage`.
- Configure-step modal pre-populates with the clicked node's values.
- No automatic admin-area redirect on flow edit unless admin mode is explicitly entered.
- Two distinct row actions per flow: "Configure Flow" (existing canvas) and "Edit" (metadata modal).
- "Never done" option in step config that hides the done-when textarea and suppresses the confidence indicator in chat for that step.
- Remove inline expert-role input from `/flows/[id]/config`; add a top-right "Edit" button there too.
- A "Share" row action on `/flows` (published only) that opens a copy-link modal pointing at a new-chat URL.
- Avatar initials derived from `flow.expertRole` (bot) and `user.firstName` (user), with sensible fallbacks.
- Two share affordances on `/chats/[id]`:
  - **Collaborate** (in the step rail header) — copies link to the current session, toast confirms.
  - **Share** (in the chat header) — copies link to start a NEW chat using this flow, toast confirms.

## 3. Non-goals

- No new DB tables. `neverDone` lives inside the existing `config` JSON on flow nodes.
- No invitations or access-control changes to share links (links open the existing public/login flow).
- No redesign of the chat layout beyond moving/relabelling two buttons.
- No back-fill of historical usage rows.

## 4. Approach

### 4.1 Sidebar (Item 1)

- `apps/web/src/components/sidebar.tsx` — split the rendered list by mode:
  - `isAdmin=true` → no flow/chat list at all (only the section nav).
  - `isAdmin=false` → header "Recent Chats"; list driven by a new tRPC procedure.
- New tRPC procedure: `session.listRecent` (protected, current user only) returning the 10 most recent sessions with `{ id, flowName, expertRole, updatedAt }`.
- Layout prefetch (`(user)/layout.tsx`) switches from `session.listPublishedFlows` to `session.listRecent`.

### 4.2 Token usage (Item 2)

- Audit `packages/adapters/src/ai/` (provider factory and `language-model-adapter.ts`) to confirm whether the language model returned to callers is wrapped by `UsageTrackingAdapter`.
- If not wrapped, wrap it in the factory so every call records to `drizzle-usage-repository`.
- Add an integration-style test: invoke the wrapped model and assert that `usageRepository.create` is called with `tokensIn`/`tokensOut`.

### 4.3 Node pre-population (Item 3)

- `apps/web/src/components/canvas/node-config-modal.tsx` — accept an `initialValues` prop and seed `useState` from it. If `initialValues` changes (re-open with different node), reset state.
- In both editor `_content.tsx` files, compute `initialValues` from `editingNode.data.config` (label, prompt, doneWhen, neverDone, etc.) and pass it to the modal.

### 4.4 Admin redirect (Item 4)

- Trace the path on the flow-edit page that leads to `/admin/...`. Likely a `redirect()` in `(user)/flows/[id]/page.tsx` or the layout when the current user has admin role. Replace with a check on the explicit "admin mode" cookie/flag (already used by the sidebar Enter/Exit admin buttons).
- Do NOT change the auth model — only respect the existing admin-mode flag.

### 4.5 Flow row actions (Item 5)

- `apps/web/src/app/(user)/flows/_content.tsx` and `apps/web/src/app/(admin)/admin/flows/_content.tsx`:
  - Rename existing "Edit" → "Configure Flow" (keeps href to `/flows/[id]/config`).
  - Add new "Edit" button (white background, `variant="outline"`) that opens the existing create-flow `Dialog` in edit mode.
- Lift the create-flow `Dialog` into a small reusable component `FlowMetadataDialog` (props: `mode: "create" | "edit"`, `initialValues`, `onSubmit`).
- New tRPC procedure: `flow.updateMetadata({ id, name, description, expertRole, icon })`.

### 4.6 Configure-step "Never done" (Item 6)

- `node-config-modal.tsx`:
  - Add a `<Select>` with two options: "Specific condition" (default) and "Never done. User can continue to interact indefinitely".
  - When "Never done" is selected, hide the `doneWhen` textarea and store `neverDone: true` in the node config JSON; otherwise `false`/absent.
- `apps/web/src/components/chat/message-feed.tsx`:
  - When rendering a message whose step config has `neverDone === true`, do not render `<ConfidenceBar>`.
- Done-evaluation logic (likely in `application/run-turn` or a step advancer): if `neverDone === true`, short-circuit to "not done" — no LLM advancement call.

### 4.7 `/flows/[id]/config` header (Item 7)

- `(user)/flows/[id]/config/_content.tsx`:
  - Remove the expert-role inline input at the top.
  - Add a top-right "Edit" button that opens `FlowMetadataDialog` in edit mode.
- Keep canvas controls and Publish/Save buttons in place.

### 4.8 Share button on `/flows` (Item 8)

- New row action "Share" (white-bg, `variant="outline"`), only visible when `flow.status === "published"`.
- Opens a small modal: read-only URL field + "Copy link" button. URL: `${origin}/chats/new?flowId={id}` (existing route — verify).
- Toast on copy: "Link copied".

### 4.9 Chat avatars (Item 9)

- `apps/web/src/components/chat/message-feed.tsx`:
  - Helper `getInitials(text: string, fallback: string)`:
    - Split on whitespace, take first letter of each token, uppercase, max 2 chars.
    - If empty → fallback.
  - Bot avatar: `getInitials(flow.expertRole, "AI")`.
  - User avatar: `getInitials(user.firstName, "U")` — pass through current viewer's first name.
- Thread these props through `_content.tsx` for `(user)/chats/[sessionId]`.

### 4.10 Chat header buttons (Item 10)

- `(user)/chats/[sessionId]/_content.tsx` + `step-progress-rail.tsx`:
  - Move current Share button DOWN to the right side of the step-progress rail; relabel to "Collaborate"; toast text: "Link copied, share it with a colleague to collaborate in this chat session".
  - In the original chat-header location, add a NEW "Share" button that copies a link to start a new chat using this flow (same URL shape as Item 8); toast text: "Link copied — share with a colleague to start a new chat session using this flow".
- `share-button.tsx` already exists for the collaborate use case; reuse it (parametrise label/url/toast).

## 5. Key entities / files

| Layer | File | Change |
|-------|------|--------|
| UI | `components/sidebar.tsx` | Recent Chats / admin trim |
| UI | `components/canvas/node-config-modal.tsx` | initialValues, neverDone select |
| UI | `components/chat/message-feed.tsx` | avatar initials, hide confidence when neverDone |
| UI | `components/chat/share-button.tsx` | parametrise (label/url/toast) |
| UI | `components/chat/step-progress-rail.tsx` | accept right-aligned action slot |
| UI | `app/(user)/flows/_content.tsx` | Configure Flow / Edit / Share actions |
| UI | `app/(user)/flows/[id]/config/_content.tsx` | drop expert-role input, add Edit button |
| UI | `app/(user)/chats/[sessionId]/_content.tsx` | new Share, moved Collaborate |
| UI | `app/(admin)/admin/flows/_content.tsx` | Configure Flow / Edit actions |
| UI | `app/(admin)/admin/flows/[id]/_content.tsx` | pre-populate node modal, fix redirect |
| UI | NEW `components/flow/flow-metadata-dialog.tsx` | shared create/edit modal |
| UI | NEW `components/flow/share-flow-dialog.tsx` | copy-link modal for `/flows` |
| Server | `server/routers/session.ts` | `listRecent` |
| Server | `server/routers/flow.ts` | `updateMetadata` |
| Adapters | `packages/adapters/src/ai/...` | wire UsageTrackingAdapter |
| Application | `application/.../run-turn` (or step advancer) | respect `neverDone` |
| Layout | `app/(user)/layout.tsx` | prefetch `session.listRecent` |

## 6. Test plan

- Sidebar: render with `isAdmin=true` → no flow list; render with sessions → "Recent Chats" with N items.
- `session.listRecent`: returns only current user's sessions, ordered by `updatedAt` desc.
- `flow.updateMetadata`: rejects when caller is not the owner; updates the four fields.
- Usage adapter: wrapping test asserting `repo.create` is called with token totals.
- Node modal: re-opening with different node resets state to that node's values.
- `neverDone` config: chat for a `neverDone` step renders messages without `<ConfidenceBar>`.
- Share buttons: clicking each copies a URL of the expected shape; toast text matches.
- Avatars: `Career Coach` → `CC`; `Coach` → `C`; empty → `AI`. User first name `Richy` → `R`; missing → `U`.

## 7. Version

`1.7.5 → 1.8.0` (MINOR — new tRPC procedures, sidebar redesign, modal reuse, share affordance. No DB schema change; `neverDone` rides in existing node `config` JSON.)
