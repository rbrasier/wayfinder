# Bug Fix: Prior-Step Fields Not Appearing in Value Selectors

## Symptom

When configuring a step's "Add request values" dropdown or a scheduled step's "Fire this step" anchor selector, the dynamic options (document template fields from conversational nodes, output fields from n8n auto nodes) never appear. Only static options ("AI decides", "Type anything", "No value") are shown.

## Root Cause

Two bugs compound each other:

### Bug 1 — `buildConfig` strips `documentTemplateFields` on every conversational-node save

In both `apps/web/src/app/(user)/flows/[id]/config/_content.tsx` and `apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx`, the `buildConfig()` function inside `handleConfigSave` explicitly enumerates only the fields it manages for conversational nodes:

```typescript
return {
  aiInstruction: values.aiInstruction,
  doneWhen: ...,
  neverDone: ...,
  outputType: values.outputType,
  documentTemplatePath: values.documentTemplatePath ?? null,
  documentTemplateFilename: values.documentTemplateFilename ?? null,
  documentTemplateContent: values.documentTemplateContent ?? null,
  // documentTemplateFields is MISSING
  // documentTemplateStructuredContent is MISSING
};
```

Every save overwrites the DB config with this object, permanently discarding `documentTemplateFields` and `documentTemplateStructuredContent`. After the first save following a template upload, these fields are gone from both the DB and the local `rfNodes` state.

### Bug 2 — Template upload never patches `rfNodes`

When a DOCX is uploaded via `POST /api/flows/[id]/nodes/[nodeId]/template`, the route:
1. Extracts `documentTemplateFields` from the DOCX and stores them in the DB.
2. Returns a JSON response that does **not** include `documentTemplateFields`.

The canvas `handleUploadTemplate` callback reads the response and updates modal form values (path, filename, content) but never updates `rfNodes`. The `priorStepFields` memo reads from `rfNodes`, so it sees `[]` for template fields immediately after upload — and Bug 1 would strip them on the next save regardless.

## Reproduction Steps

1. Create a flow with two steps:
   - Step 1: Conversational, "Generate document" output type, DOCX template uploaded
   - Step 2: Auto (n8n) or Scheduled
2. Open Step 2's config modal.
3. Observe the "Add request values" / anchor dropdown — no Step 1 fields appear.

Alternative (even simpler):
1. Create a flow, configure Step 1 as above and save.
2. Re-open Step 1's config modal, change the name, save again.
3. Open Step 2 — fields still don't appear (even after page reload, because Bug 1 wiped them from the DB on the second save).

## Fix Plan

### 1. Template route response — include `documentTemplateFields`

File: `apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts`

Add `documentTemplateFields: fieldsResult.data.fields` to the POST response JSON so callers can patch `rfNodes`.

### 2. User canvas — patch `rfNodes` after upload; preserve fields on save

File: `apps/web/src/app/(user)/flows/[id]/config/_content.tsx`

- `handleUploadTemplate`: after a successful upload, call `setRfNodes` to merge `documentTemplateFields` into the uploading node's `config`.
- `buildConfig` conversational branch: read the existing rfNode's config via `rfNodes.find(...)` and carry `documentTemplateFields` + `documentTemplateStructuredContent` forward. Clear them only when `outputType !== "generate_document"` or `documentTemplatePath` is null (template explicitly removed).

### 3. Admin canvas — same two changes

File: `apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx`

Identical changes to the admin canvas.

## Version Bump

PATCH — no schema changes, no new routes, UI fix only.

---

## Implementation Summary

### Root cause confirmed

Two bugs compounding each other. Both traced to the same `buildConfig()` function pattern in the user and admin canvas files.

### Fix applied

**`apps/web/src/app/api/flows/[id]/nodes/[nodeId]/template/route.ts`**
- Added `documentTemplateFields: fieldsResult.data.fields` to the POST response JSON.

**`apps/web/src/app/(user)/flows/[id]/config/_content.tsx`**
- `handleUploadTemplate`: after a successful upload, patches `rfNodes` with `documentTemplateFields` from the response, so `priorStepFields` reflects template fields immediately without requiring a page reload.
- `handleConfigSave` → `buildConfig` conversational branch: reads `existingNodeConfig` from `rfNodes` and carries `documentTemplateFields` + `documentTemplateStructuredContent` forward. Clears them only when `outputType !== "generate_document"` or `documentTemplatePath` is null.

**`apps/web/src/app/(admin)/admin/flows/[id]/_content.tsx`**
- Same two changes as the user canvas.

### Regression test added

`tests/e2e/fix-prior-step-fields-stripped.spec.ts` — intercepts the template upload API with mock `documentTemplateFields`, then verifies:
1. A subsequently configured auto step's value selector shows the template fields from the prior conversational step.
2. After re-saving the conversational step (plain name change), the same fields still appear (guards against bug 1 recurring).
