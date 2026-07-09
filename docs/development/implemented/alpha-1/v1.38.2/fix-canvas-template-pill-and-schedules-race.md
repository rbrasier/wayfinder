# Bugfix — canvas template filename pill vanishes; schedules page render race

Follow-up to v1.38.1: the last two CI e2e failures.

## 1. Template upload filename pill disappears on the flow canvas

### Symptom
`fix-prior-step-fields-stripped.spec.ts:182` failed waiting for the uploaded
`mock-template.docx` pill. Reproduced live: the upload POST is made and returns
a filename, but the modal keeps showing "Click to upload a .docx template".

### Root cause (verified)
`NodeConfigModal` resets its form state from `initialValues` via
`useEffect(…, [open, initialValues])`. Both canvas upload handlers
(`(admin)/admin/flows/[id]/_content.tsx`, `(user)/flows/[id]/config/_content.tsx`)
patched `rfNodes` with **only** `documentTemplateFields` after an upload. That
patch changes `initialValues`, which fires the reset effect and wipes the
`documentTemplateFilename` that `handleFileChange` had just `set()` — so the pill
flashes away. This is a real UX bug (the upload confirmation vanishes), not just
a test artifact.

### Fix
Patch the **whole** upload result — `documentTemplatePath`,
`documentTemplateFilename`, `documentTemplateContent` and
`documentTemplateFields` — into `rfNodes`. Now the reset re-syncs from a config
that already carries the filename, so the pill persists (and the values are
forwarded on the next save, as before).

## 2. `/admin/schedules` renders neither table nor empty state

### Symptom
`phase-schedule-run-logging.spec.ts:15` failed: `hasTable || hasEmpty` was
false even though the page heading was present. Intermittent locally, consistent
on (slower) CI.

### Root cause (verified)
The page prefetches `schedule.listRecentRuns` with `void` (not awaited), so the
client query can still be loading when `waitForLoadState('networkidle')`
resolves; the loading state renders a `TableSkeletonRows` block that is neither a
`<table>` nor the "No scheduled runs yet" empty state. The test asserted
immediately instead of waiting for the query to resolve.

### Fix
Test-only: wait for `getByRole('table').or(getByText(/no scheduled runs yet/i))`
to be visible before asserting console cleanliness — the resolved state, not the
skeleton.

## Regression coverage
Both e2e specs are the guard: each failed before and passes after. App change
covers both the admin and user canvas surfaces.
