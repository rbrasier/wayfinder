# Bug Fix — Scheduled AI spec resolution ignores current time

- **Status**: Implemented
- **Target version**: 1.34.1 (PATCH — no schema change)
- **Severity**: Major — scheduled steps with "AI decides" specSource are completely broken

## 1. Symptom

Two failure modes observed when a scheduled workflow step has `specSource: { kind: "ai" }`:

**Failure A — Unparseable timestamp**
```
Scheduled step "Wait based on input" could not start: Unparseable timestamp: "30 seconds from now".
```
The AI returns natural language instead of an ISO 8601 timestamp because it doesn't know it needs to compute an absolute time from "now".

**Failure B — Wrong timestamp (past date)**
The AI does produce an ISO timestamp, but it is anchored to its training-data cutoff rather than the actual current time:
```
Scheduled step: Wait based on input. Next: 2025-01-10T12:00:15.000Z.
```
(Actual date is 2026-06-08; expected was ~15 seconds in the future.)

## 2. Root Cause

`resolveAiSpec()` in `packages/application/src/use-cases/scheduling/schedule-node-event.ts` builds the instruction prompt:

```typescript
const instruction = describe
  ? `Decide the exact date and time this scheduled step should fire. The author described how to calculate it: "${describe}". Use the session context below. Respond with a single ISO 8601 timestamp, e.g. 2026-12-25T09:00:00.000Z.`
  : "Decide the exact date and time this scheduled step should fire based on the session context. Respond with a single ISO 8601 timestamp, e.g. 2026-12-25T09:00:00.000Z.";
```

The instruction **never tells the AI what the current date/time is**. The AI therefore:
- Falls back to natural language when given a relative expression like "30 seconds" (Failure A)
- Anchors absolute timestamps to its training-data cutoff, not wall-clock now (Failure B)

`ScheduleNodeEvent` already holds `this.clock`, so `this.clock.now()` is available in `resolveAiSpec` at no extra cost.

## 3. Reproduction Steps

1. Create a flow with a scheduled node configured as `kind: "at"`, `specSource: { kind: "ai" }`.
2. Run the session. When asked "how long should this step wait?", answer "30 seconds".
3. Observe either:
   - `Unparseable timestamp: "30 seconds from now"` in the session log, or
   - A scheduled fire time in 2025.

## 4. Fix Plan

**`packages/application/src/use-cases/scheduling/schedule-node-event.ts`**

In `resolveAiSpec()`, call `this.clock.now()` and embed the ISO string in both instruction variants:

```typescript
const nowIso = this.clock.now().toISOString();
const instruction = describe
  ? `Decide the exact date and time this scheduled step should fire. The current date and time is ${nowIso}. The author described how to calculate it: "${describe}". Use the session context below. Respond with a single ISO 8601 timestamp, e.g. 2026-12-25T09:00:00.000Z.`
  : `Decide the exact date and time this scheduled step should fire based on the session context. The current date and time is ${nowIso}. Respond with a single ISO 8601 timestamp, e.g. 2026-12-25T09:00:00.000Z.`;
```

**`packages/application/src/use-cases/scheduling/schedule-node-event.test.ts`**

Add a regression test that asserts the current timestamp appears in the system prompt passed to the language model (similar to the existing `describeText` threading test).

## 5. Files Changed

| File | Change |
|------|--------|
| `packages/application/src/use-cases/scheduling/schedule-node-event.ts` | Include `nowIso` in AI instruction |
| `packages/application/src/use-cases/scheduling/schedule-node-event.test.ts` | Regression test for `nowIso` in system prompt |
| `VERSION` + root `package.json` | Bump to 1.34.2 |
