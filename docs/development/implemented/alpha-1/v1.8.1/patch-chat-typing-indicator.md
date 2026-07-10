# Patch: Chat Typing Indicator

**Version bump:** `1.8.0` → `1.8.1` (PATCH — UI tweak, no schema changes)

---

## Problem

After a user sends a message on `/chats/[id]`, there is no visual feedback that
an AI response is incoming. The only indication is a `"…"` placeholder string
inside the assistant bubble, which is easy to miss and not obviously animated.

## Solution

Replace the `"…"` placeholder with a dedicated `TypingIndicator` component
that renders three dots animating sequentially (staggered pulse), styled to
match the existing assistant message bubble.

---

## Files to Create

### `apps/web/src/components/chat/typing-indicator.tsx`

A pure presentational component. Three `<span>` elements, each using Tailwind's
`animate-pulse` with staggered `animation-delay` values via inline styles
(150 ms apart). Dots use `bg-[#918d87]` to match the existing muted text colour.

No props required.

---

## Files to Modify

### `apps/web/src/components/chat/message-feed.tsx`

In the streaming message map, the assistant message bubble currently renders:

```tsx
{msg.content || (isStreaming && msg.role === "assistant" ? "…" : "")}
```

Replace with:

```tsx
{msg.content
  ? msg.content
  : isStreaming && msg.role === "assistant"
    ? <TypingIndicator />
    : ""}
```

Import `TypingIndicator` at the top of the file.

---

## Acceptance Criteria

1. After submitting a user message, an AI bubble with three pulsing dots appears
   in the message feed.
2. The dots animate sequentially (not simultaneously).
3. Once the first AI tokens arrive, the dots are replaced by the streamed text.
4. The bubble's border, shadow, and avatar styling match the existing AI bubbles.
5. No regressions in non-streaming (db-hydrated) message rendering.

---

## Tests

- `typing-indicator.test.tsx` — renders three dot elements; snapshot test.
- `message-feed.test.tsx` (existing or new) — when `isStreaming=true` and last
  assistant message has empty content, the feed renders `TypingIndicator`; when
  content is present, it renders the content text instead.

---

## Out of Scope

- Any changes to backend streaming logic
- Changes to the confidence bar or milestone pill components
- DB migrations
