# Phase — Configurable chat disclaimers

- **Status**: Implemented (v0.28.14)
- **Target version**: 0.28.14 (bump: **PATCH** — new admin-configurable copy stored
  in the existing settings row store; no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Branch**: `enhance/chat-disclaimers`
- **Depends on**: `admin_system_settings` (`packages/adapters/src/db/schema/wayfinder.ts`),
  `RuntimeConfigStore` (`packages/adapters/src/config/runtime-config-store.ts`),
  the site-banner config it is modelled on (`packages/domain/src/entities/site-banner.ts`),
  the chat composer (`apps/web/src/components/chat/chat-composer.tsx`)

## 1. Problem

Two AI-verification disclaimers are needed in the chat surface, and neither is
configurable today.

The line under the chat composer is a hard-coded string in
`apps/web/src/components/chat/chat-composer.tsx:176` — "Wayfinder works
agentically — it asks follow-up questions and signals when each step is
complete." It says nothing about verification, and an operator who needs
different wording (a regulator's phrasing, a different language, none at all)
has to change code and redeploy.

There is no start-of-chat warning at all. A user opening a chat session gets no
statement that Wayfinder's output is AI-generated and needs human verification.
For the governed, document-producing workflows Wayfinder targets, an operator
may need that warning acknowledged before work starts — and may need to choose
how insistent it is.

## 2. Goals

- An admin can edit the composer disclaimer text from Configuration →
  Notifications, and can blank it to remove the line entirely.
- An admin can enable a start-of-chat disclaimer modal, with their own message
  text, in one of three modes: off, once only, or at the start of every new chat.
- The modal is **off by default**, so no existing deployment gains a new
  interruption on upgrade.
- Both settings persist in the existing `admin_system_settings` row store, so the
  change ships as a patch with no migration.

## 3. Non-goals

Per-organisation or per-flow disclaimer overrides; server-side persistence of the
user's acknowledgement (that needs a migration, so it is out of a patch); rich
text, links or styling controls in either disclaimer; a disclaimer anywhere
outside the chat surface — the site banner already covers site-wide notices.

## 4. Approach

Follow the site-banner pattern end to end, because it is the same shape of thing:
one admin-authored JSON blob, read on a hot render path, edited from one card.

A new domain entity `ChatDisclaimerConfig` owns the shape, the defaults, a
tolerant parser that degrades field by field, and — importantly — the pure
decision function that says whether the modal should show. Putting the decision
in `packages/domain` keeps the three-mode truth table unit-testable without
rendering anything.

`RuntimeConfigStore` gains a cached getter and an invalidator, matching
`getSiteBannerConfig` / `invalidateSiteBanner` exactly. The tRPC router gains
`getChatDisclaimer` (authenticated — every signed-in user in a chat needs it, and
it carries no secret material) and `setChatDisclaimer` (admin).

The acknowledgement is browser-local. In `once` mode the key is the user id; in
`every_session` mode it is the user id plus the session id, so re-opening the
same chat does not re-prompt but a genuinely new chat does. `localStorage` reads
and writes are wrapped — a browser blocking site data must show the modal, not
crash the chat page.

No schema change: `admin_system_settings` is a key/value table and a new key
needs no DDL.

## 5. Key entities / files

**domain** (`packages/domain`)

- `src/entities/chat-disclaimer.ts` — new.
  - `type ChatDisclaimerModalMode = "off" | "once" | "every_session"`
  - `interface ChatDisclaimerConfig { composerText: string; modalMode: ChatDisclaimerModalMode; modalText: string }`
  - `CHAT_DISCLAIMER_CONFIG_SETTING_KEY = "chat_disclaimer_config"`
  - `DEFAULT_CHAT_DISCLAIMER_COMPOSER_TEXT` = "Wayfinder asks follow up questions
    and signals when each step is complete. AI can make mistakes, and requires
    human verification"
  - `DEFAULT_CHAT_DISCLAIMER_MODAL_TEXT` = "Wayfinder is a tool to help you work
    through complex business processes. AI can make mistakes — all output needs to
    be verified by you before it is relied on."
  - `createDefaultChatDisclaimerConfig()` — modal mode `"off"`.
  - `parseChatDisclaimerConfig(raw, fallback)` — tolerant, per-field.
  - `isChatDisclaimerModalEnabled(config)` — mode is not `"off"` **and** the
    message is non-blank.
  - `chatDisclaimerAcknowledgementKey(config, userId, sessionId)` — the storage
    key for the current mode, or `null` when the modal is disabled.
- `src/index.ts` — export the new module.

**adapters** (`packages/adapters`)

- `src/config/runtime-config-store.ts` — `chatDisclaimerCache` /
  `chatDisclaimerPending`, `getChatDisclaimerConfig()`, `invalidateChatDisclaimer()`.

**apps/web**

- `src/server/routers/settings.ts` — `getChatDisclaimer` (`authenticatedProcedure`),
  `setChatDisclaimer` (`adminProcedure`) with a zod input schema.
- `src/components/settings/chat-disclaimer-card.tsx` — new admin card.
- `src/app/(admin)/admin/settings/page.tsx` — render it in the Notifications section.
- `src/components/chat/chat-composer.tsx` — render the configured text; blank
  renders no line.
- `src/components/chat/chat-disclaimer-modal.tsx` — new; the modal plus its
  `localStorage` acknowledgement handling.
- `src/app/(user)/chats/[sessionId]/_content.tsx` — mount the modal.

## 6. Implementation steps (test-first per CLAUDE.md)

1. **Domain entity.** Write `chat-disclaimer.test.ts` covering defaults (modal off),
   tolerant parse of a malformed row, an unknown mode string, partial objects,
   the enabled/disabled rule for blank message text, and the acknowledgement-key
   truth table across all three modes. Then write `chat-disclaimer.ts` and export it.
2. **Runtime config.** Extend `runtime-config-store.test.ts` — cached read, fallback
   when the row is missing or unparseable, and a fresh read after
   `invalidateChatDisclaimer()`. Then add the getter, cache and invalidator.
3. **Router.** Add `getChatDisclaimer` / `setChatDisclaimer`, invalidating the
   store on write.
4. **Admin card.** `ChatDisclaimerCard` with a textarea for the composer line, a
   mode select, a textarea for the modal message and a Save button; slot it into
   the Notifications `CollapsibleSection` after `NotificationSettingsCard`.
5. **Composer.** Read the config with the same query options `SiteBanner` uses
   (long stale time, no refetch on focus); render `composerText`, or nothing when
   it is blank. "Uploading file…" still takes precedence.
6. **Modal.** Write `chat-disclaimer-modal.test.ts` over the storage helpers
   (acknowledged / not acknowledged / throwing storage), then the component, then
   mount it on the chat session page.
7. Run `./validate.sh` after each step.

## 7. Acceptance criteria

- With no stored row, the composer shows the default text and no modal appears.
- Blanking the composer text removes the line under the input entirely.
- With mode `once`, the modal appears on the first chat a user opens and never
  again on that browser after they acknowledge it.
- With mode `every_session`, the modal appears once per chat session and does not
  re-appear when the same chat is revisited.
- With mode `off`, or with a blank message, the modal never renders.
- Admin-authored text renders as plain text — no `dangerouslySetInnerHTML` on
  either path.
- A malformed `chat_disclaimer_config` row falls back to defaults rather than
  breaking the chat page.

## 8. E2E decision

**No Playwright spec.** Checked against the six groups in
[`docs/guides/e2e-test-policy.md`](../../guides/e2e-test-policy.md): this is
config parsing plus a conditional render. It is not auth session lifecycle, not
streaming into the DOM, not upload/download, not navigation state across a page
load, not an accessibility surface, and not smoke. Coverage belongs at the layer
that owns the logic — `packages/domain` for the parse and the mode decision,
`packages/adapters` for the cached read, and a component-level test for the
acknowledgement storage.

## 9. Risks / open questions

- **Stored XSS.** The composer line and modal body are admin-authored strings. They
  must reach the DOM as text nodes only.
- **Query on a hot path.** The composer renders on every keystroke; the config
  query needs a stale time and no refetch-on-focus so it stays off the request path.
- **Acknowledgement is per browser.** A user on a second device sees the modal
  again. Accepted: server-side persistence needs a migration and this is a patch.
