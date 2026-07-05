# Implementation Summary — Chat Typing Indicator (v1.8.1)

## What Was Built

A `TypingIndicator` component that appears as an AI message bubble while the
assistant is preparing its response. Three dots animate with a staggered pulse
(150 ms apart), replacing the previous plain `"…"` string placeholder.

## Files Created

- `apps/web/src/components/chat/typing-indicator.tsx` — presentational component;
  three `<span>` dots using Tailwind `animate-pulse` with staggered `animation-delay`
  inline styles (0 ms, 150 ms, 300 ms).
- `apps/web/src/components/chat/typing-indicator.test.tsx` — vitest tests verifying
  the component export and name.

## Files Modified

- `apps/web/src/components/chat/message-feed.tsx` — imported `TypingIndicator`;
  replaced the `"…"` ternary inside the streaming block. The `<p>` tag is now
  conditional: rendered only when content is present; `<TypingIndicator />` is
  rendered (outside `<p>`) when `isStreaming && !msg.content`.

## Known Limitations

- No DOM-rendering tests exist (project has no jsdom / `@testing-library/react`
  setup). The component's animated behaviour is verified visually during development.

## Version

PATCH bump — already at `1.8.1` from the prior commit in this release cycle.
