# Implementation Summary — Configurable chat disclaimers

- **Version**: 0.28.14 (PATCH — no schema change, no migration)
- **Base branch**: `release/alpha-2`
- **Branch**: `enhance/chat-disclaimers`
- **Phase doc**: [`chat-disclaimers.phase.md`](./chat-disclaimers.phase.md)

## What changed

The two AI-verification disclaimers in the chat surface are now admin-configurable
from Configuration → Notifications, in a new **Chat disclaimers** card.

The line under the chat composer was a hard-coded string; it is now read from
config, and blanking it removes the line entirely. Its default is the wording the
maintainer specified: "Wayfinder asks follow up questions and signals when each
step is complete. AI can make mistakes, and requires human verification".

A start-of-chat disclaimer modal is new. An admin writes the message and picks
one of three modes — **off** (the default, so no existing deployment gains an
interruption on upgrade), **once only** (the first chat a user opens), or **every
new chat** (once per chat session). The user's acknowledgement is held in their
browser's `localStorage`, keyed by user id in `once` mode and by user id plus
session id in `every_session` mode.

Both settings live in one JSON row under the `chat_disclaimer_config` key in the
existing `admin_system_settings` table (ADR-041), so nothing was migrated.

## Changes by layer

**domain** (`packages/domain`)

- `src/entities/chat-disclaimer.ts` — new. `ChatDisclaimerConfig`,
  `ChatDisclaimerModalMode` and its closed `CHAT_DISCLAIMER_MODAL_MODES` set, the
  setting key, both default strings, `createDefaultChatDisclaimerConfig`, the
  tolerant `parseChatDisclaimerConfig`, `resolveChatDisclaimerComposerText`,
  `isChatDisclaimerModalEnabled` and `chatDisclaimerAcknowledgementKey`.
- `src/entities/index.ts` — exports it.

**adapters** (`packages/adapters`)

- `src/config/runtime-config-store.ts` — `getChatDisclaimerConfig()` with its
  cache and pending-promise pair, and `invalidateChatDisclaimer()`, matching the
  site-banner pair exactly.

**apps/web — server**

- `src/server/routers/settings-presentation.ts` — new module holding
  `getChatDisclaimer` (authenticated read), `setChatDisclaimer` (admin write) and
  their zod schema, **plus the existing site-banner and About-links procedures
  moved out of `settings.ts`** (see Deviations).
- `src/server/routers/settings.ts` — spreads the new module in; the moved
  procedures, their schemas and the imports only they used are gone.

**apps/web — UI**

- `src/components/settings/chat-disclaimer-card.tsx` — new. Composer textarea,
  mode select, modal-message textarea, "Restore default wording" and Save.
- `src/app/(admin)/admin/settings/page.tsx` — renders it in the Notifications
  section, between the notification-prefs and site-banner cards.
- `src/components/chat/chat-composer.tsx` — reads the config (60s stale time, no
  refetch on focus, because this component re-renders on every keystroke) and
  renders the configured text; the whole `<p>` is omitted when the text is blank
  and nothing is uploading.
- `src/components/chat/chat-disclaimer-state.ts` — new. The open/closed decision
  and both guarded `localStorage` accesses.
- `src/components/chat/chat-disclaimer-modal.tsx` — new. Dialog titled "Before you
  begin" with a single "I understand" action.
- `src/app/(user)/chats/[sessionId]/_content.tsx` — mounts the modal once the
  viewer's user id is known.

## Tests

Written before each implementation file, per CLAUDE.md.

- `packages/domain/src/entities/chat-disclaimer.test.ts` — 19 tests: the defaults
  (including the modal being off and the default object being fresh per call),
  tolerant parse of malformed JSON / arrays / bare values / partial rows / wrong
  types, rejection of an unrecognised mode, the blank-hides rule for the composer
  line and the blank-disables rule for the modal, and the acknowledgement-key
  truth table across all three modes and two users.
- `packages/adapters/src/config/runtime-config-store.test.ts` — 6 added: default
  when nothing is stored, a fully-specified row, unknown-mode fallback,
  unparseable-row fallback, re-read after `invalidateChatDisclaimer`, and that
  repeated reads hit the repository once.
- `apps/web/src/components/chat/chat-disclaimer-state.test.ts` — 13 tests: reads
  and writes against a fake storage, a storage that throws on every access (reads
  as "not acknowledged" so the warning still shows, and the write is swallowed), a
  null storage, and the per-mode open decision including "a second chat does not
  re-prompt in `once` mode" and "a new chat does re-prompt in `every_session`".

`./validate.sh` — 24 passed, 0 failed.

## E2E decision

**No Playwright spec written.** Checked against the six groups in
`docs/guides/e2e-test-policy.md`: config parsing plus a conditional render matches
none of them. The nearest call is group 4 (navigation state across a page load),
since the `once` acknowledgement survives a reload — but what survives is
`localStorage` itself, which is browser behaviour, not app logic. The key
derivation and the guarded storage access are covered by the component-level test
above.

## Deviations from the approved summary

**One.** The approved summary put `getChatDisclaimer` / `setChatDisclaimer`
directly in `apps/web/src/server/routers/settings.ts`. Doing so pushed that file
to 802 lines and `validate.sh` check 16 fails at 800. Rather than shrink the new
code, the presentation-copy procedures were extracted into a new
`settings-presentation.ts` — the site banner, About links and chat disclaimers,
which are the same shape of thing — following the `settings-auth.ts` /
`settings-directory.ts` split the router already uses. `settings.ts` is now 687
lines. No behaviour changed for the moved procedures; they keep their names,
their auth level and their wire contract.

Everything else landed as approved, including the modal defaulting to off.

## Known limitations

- The acknowledgement is per browser. A user on a second device, in a private
  window, or after clearing site data sees the modal again. Server-side
  persistence needs a schema change and so was out of scope for a patch.
- The modal title is fixed at "Before you begin"; only the body text is
  configurable.
- One global setting — there is no per-organisation or per-flow override.
