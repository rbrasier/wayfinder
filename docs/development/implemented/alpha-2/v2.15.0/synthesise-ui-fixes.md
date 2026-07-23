# Enhancement: Synthesise Information UI fixes

Aligns the Synthesise Information surface (list + edit) with the rest of the app
shell and the node-configuration look and feel, and reworks the output half into
a Structured / Template choice that derives fields the way the conversational
node does. Refines unreleased work, so it targets `main`. No DB migration — the
extraction schema lives in the `FlowSnapshot` jsonb.

Phase doc: `synthesise-ui-fixes.phase.md` (same directory).

## What changed

- **Sidebar** (`apps/web/src/components/sidebar.tsx`) — the user nav is now built
  by `buildUserNav(extractionEnabled)`, placing **Synthesise Information** inline
  directly under **Approvals**. The standalone Synthesise block and its extra
  `<hr>` were removed, so only the Recent Chats rule remains. The admin nav is
  unchanged.
- **List screen** (`apps/web/src/app/(user)/synthesise/_content.tsx`) — adopts the
  `/chats` shell: full-height column, a fixed `h-[52px]` header with the title on
  the left and **New synthesis** on the top right, and full-width rows in a
  scrolling body.
- **Edit screen** (`apps/web/src/app/(user)/synthesise/[id]/edit/_content.tsx` →
  now a thin data wrapper; header + body live in `EditorCards`) — a matching
  fixed header with **Save** on the top right, a **⋯ menu** (like
  `/flows/[id]/config`) holding **Runs** and **Delete**, and a **Publish** button
  that is present but **disabled** until its semantics are defined. Delete opens a
  confirm dialog and calls `extraction.delete`.
- **Editor cards** (`apps/web/src/components/extraction/editor-cards.tsx`) —
  rewritten as two large **focus cards**. The focused card is enlarged, raised,
  and overlaps its sibling; the unfocused card sits behind a frosted overlay
  reading "Configure input/output" + "Click here to configure" that focuses it on
  click. **Save** is in the page header regardless of focus; **Run sample** is in
  the Output card's header. Radios/checkboxes are replaced by node-config-style
  segmented toggles and switches.
- **Fields to extract** (`extraction-field-editor.tsx` + `extraction-editor-model.ts`)
  — the single-field editor pattern (label + type dropdown + cog). The cog modal
  holds the per-field **instruction**, *Required*, and the type-specific
  limits/choices; type and configuration serialise into the field's annotation
  line via the domain template-field serialiser (no domain change).
- **Output mode** — a **Structured output (default) / Template** segmented choice
  (the conversational node's approach, minus the unstructured mode).
  - *Structured:* fields are authored manually; output is the record grid (xlsx),
    no format picker.
  - *Template:* the author just uploads a `.docx`/`.xlsx`; the format is inferred.
    A note above the upload box states spreadsheets need a header row. Fields are
    **auto-derived** from the template's header row / `{{ tags }}` and each keeps
    an **editable instruction** (labels/types locked).
- **Server** (`apps/web/src/server/routers/extraction.ts`):
  - `extraction.delete` — author-gated soft delete via the existing `deleteFlow`
    use case (extraction flows are `flow` rows with `flowType: "extraction"`).
  - `extraction.parseOutputTemplate` — author-gated; parses an uploaded template
    through a `DocumentGeneratorRouter` (`extractTags`/`extractFields`/
    `extractFullText`), stores it to object storage, and returns the
    `FlowContextDoc` plus derived `TemplateField[]`, format, and spreadsheet mode.
    No new tables.

## Design decisions (confirmed with the author)

- Template mode auto-derives fields **and** keeps editable per-field instructions.
- Publish stays disabled this pass; the Runs flow is left as-is behind the ⋯ menu.

## Testing

- **Unit:** `extraction-editor-model.test.ts` — field model ↔ annotation-line
  round-trips (text/currency/multi-select), instruction fallback to the label,
  template-field → locked model mapping, and `deriveOutputMode` (structured
  default vs template when an output template is present).
- **Component (smoke):** `extraction-field-editor.test.tsx`, matching the repo's
  export-check convention.
- **E2E:** `apps/web/e2e/enhance-synthesise-ui.spec.ts` — list header + New
  synthesis; edit header Save / disabled Publish / ⋯ menu (Runs + Delete); card
  focus toggle revealing Run sample and the sibling overlay; Structured ↔
  Template swap surfacing the upload affordance and header-row guidance. The
  existing `phase-extraction-flows-author-sample.spec.ts` was updated to focus
  the Output card before asserting Run sample (it now lives there). Both are
  skip-guarded like the other extraction phase specs.

## Validation

- `./validate.sh` — all checks pass (typecheck, lint, 1,906 unit tests, domain
  purity, table names, version sync, doc lifecycle, coverage, a11y).
- **Version:** MINOR bump `2.14.1` → `2.15.0`.
