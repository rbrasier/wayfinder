# Bug Fix: Modal editor UI issues (icon picker clipping, select-type revert, admin inline editing)

Three independent UI defects reported together against the flow, node, and
admin surfaces. All are presentation/state bugs with no schema impact.

## Symptom

1. **Icon picker clipped inside the flow modal.** On the New/Edit Flow modal,
   the "More…" link under _Icon_ opens a searchable icon panel. The panel was
   trapped inside the modal and cut off — its search box and lower rows were
   invisible because the panel opened downward from the last field and the
   dialog clips its overflow.
2. **Single-select / Multi-select reverts to Text.** In the node config modal,
   under _Fields to capture_ (structured conversation), choosing "Single-select"
   or "Multi-select" in a field's type dropdown immediately snapped back to
   "Text" (or appeared not to select at all).
3. **Groups & Organisations rows edited inline.** The admin Groups and
   Organisations lists mixed read and write: each row carried inline inputs
   (organisation rename field, email-domain field, per-row organisation
   dropdown). There was no single editor, and the row was never a clean
   read-only summary.

## Reproduction

1. Icon picker:
   1. `/admin/flows` → **New flow**.
   2. Under _Icon_, click **More…**.
   3. The search field / lower icon rows are clipped by the dialog edge.
2. Select-type revert:
   1. Open a flow's config canvas, open a conversational step.
   2. Set _Output type_ → **Structured conversation**.
   3. Under _Fields to capture_, change a field's type dropdown to
      **Single-select**.
   4. The dropdown reverts to **Text**.
3. Admin inline editing:
   1. `/admin/organisations` → each existing row shows editable inputs rather
      than plain text with Edit/Delete actions. Same shape on `/admin/groups`.

## Root Cause (verified)

1. **Icon picker** — `apps/web/src/components/flow/icon-picker.tsx` positioned
   the panel with `absolute left-0 top-full` (opening _downward_). The _Icon_
   field is the last row of `DialogBody`, and `DialogContent`
   (`apps/web/src/components/ui/dialog.tsx:37`) sets `overflow-hidden`, so a
   downward panel extends past the dialog's bottom edge and is clipped.
2. **Select-type revert** — `structured-field-editor.tsx` was a fully
   controlled component: it re-derived its field models from the serialised
   `lines` prop on every render (`lines.map(lineToModel)`). An options field
   with no choices yet serialises to a bare label — `templateFieldToLine`
   (`packages/domain/src/entities/template-field.ts:411`) only emits the
   `(options: …)` / `(multi-options: …)` annotation when
   `field.options.length > 0`. So selecting "Single-select" before any choices
   exist produced a label-only line, which `lineToModel` parsed straight back
   to `text`. The type could not survive the round-trip.
3. **Admin inline editing** — `groups/_content.tsx` and
   `organisations/_content.tsx` rendered write controls directly in each list
   row (`RenameField`, `EmailDomainField`, a per-row organisation `<select>`),
   and their "New …" modal only ever created. There was no create/edit modal
   and no read-only row.

## Fix Plan

1. Anchor the icon panel to the bottom of its trigger (open _upward_):
   `top-full mt-1.5` → `bottom-full mb-1.5`, so it stays inside the dialog.
2. Give `StructuredFieldEditor` local model state so the chosen type is held in
   the component, not re-derived from the round-tripped line. Re-seed from
   `lines` only when they change for a reason other than the editor's own
   commit (a different step loaded into the same instance).
3. Turn the Groups and Organisations rows into read-only text with **Edit** and
   **Delete** buttons, and make the former "New …" modal a create/edit editor
   (`group.update` / `organisation.update` on save) reused for existing items.

## Implementation Summary

- **Root cause:** (1) downward-opening panel clipped by the dialog's
  `overflow-hidden`; (2) field type re-derived every render from a serialised
  line that omits the options annotation until choices exist, so an
  option-less select round-tripped back to text; (3) admin rows embedded write
  controls instead of deferring to a single editor.
- **Fix applied:**
  - `apps/web/src/components/flow/icon-picker.tsx` — the panel is now
    `absolute left-0 bottom-full mb-1.5`, opening above the "More…" trigger and
    remaining within `DialogContent`.
  - `apps/web/src/components/canvas/structured-field-editor.tsx` — field models
    are held in `useState`; commits push serialised lines up and record them in
    a ref, and a `useEffect` re-seeds from `lines` only when they differ from
    the last emitted value (`arraysEqual`). The Single/Multi-select choice now
    persists before any options are entered.
  - `apps/web/src/app/(admin)/admin/groups/_content.tsx` and
    `.../organisations/_content.tsx` — each row renders its data as text
    (name, description/organisation for groups; name, email domain for orgs)
    with Edit + Delete buttons. `CreateGroupModal` → `GroupModal` and
    `CreateOrganisationModal` → `OrganisationModal` now take the record being
    edited and call the update mutation in edit mode. The inline
    `RenameField`, `EmailDomainField`, and per-row organisation `<select>` were
    removed (dead code). The group editor gained a Description field so the
    modal edits everything the row shows.
- **Regression / E2E test:**
  `apps/web/e2e/fix-modal-editor-ui-fixes.spec.ts` covers all three:
  - the icon panel's bounding box sits at or above its trigger and within the
    dialog (fails on the old downward panel);
  - a field's type dropdown set to "Single-select" retains that value with no
    options entered (fails on the old controlled editor);
  - the Groups and Organisations rows expose Edit/Delete and no longer render
    inline rename/domain inputs, and Edit opens a prefilled editor.
  `apps/web/e2e/enhance-admin-orgs-ui-cleanup.spec.ts` was updated: its final
  assertion checked for the now-removed inline rename input.
- **Version:** PATCH bump `2.11.0` → `2.11.1`.
