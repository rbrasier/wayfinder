# Phase — Synthesise Information UI fixes

**Type:** Enhancement (`/enhance`)
**Base branch:** `main` (the Synthesise / extraction-flows feature is unreleased —
it only exists on `main`, so this refinement of unreleased work targets `main`,
not the current alpha branch).
**Version bump:** MINOR — `2.14.1` → `2.15.0`. New authoring UX and output modes;
no DB migration (the extraction schema lives in the `FlowSnapshot` jsonb).

## Why

The Synthesise Information surface (list + edit) was shipped with a bespoke
layout that does not match the rest of the app (`/chats`, `/flows`) and a
first-pass authoring editor whose controls (radios, checkboxes, free-text
annotation/format pickers) diverge from the established node-configuration
patterns. This phase aligns the surface with the app shell and the node-config
look and feel, and reworks the output half so authors choose between
**structured output** and a **template**, deriving fields the same way the
conversational node does.

## What changes

### 1. Sidebar
- Move **Synthesise Information** inline directly under **Approvals** in the user
  navigation (was appended after Settings behind its own rule).
- Remove the extra `<hr>` that wrapped the standalone Synthesise block; only the
  Recent Chats rule remains.

### 2. List screen (`/synthesise`)
- Adopt the `/chats` shell: full-height column, a fixed header bar with the title
  on the left and **New synthesis** on the top right, and full-width list rows.

### 3. Edit screen (`/synthesise/[id]/edit`)
- Fixed header bar matching the list: title left; on the top right, **Save**, a
  **⋯ menu** (like `/flows/[id]` config) holding **Runs** and **Delete**, and a
  **Publish** button that is present but **disabled** ("until we explore what it
  means in practice").
- Delete opens a confirm dialog and calls a new `extraction.delete` procedure,
  then returns to `/synthesise`.

### 4. Editor cards
- Two large cards (Input, Output). One is **focused** (enlarged, overlapping);
  the other is **frosted** with an overlay reading "Configure input/output" and a
  "Click here to configure" subtext. Clicking the overlay focuses that card.
- **Save** lives in the page header regardless of which card is focused.
  **Run sample** lives in the top-right of the Output card.
- Radios/checkboxes become **toggles** matching the node-config switch style.
- **Fields to extract** use the single-field editor pattern (label + type
  dropdown + cog): type and its configuration live in one row; the cog modal
  holds *Required*, the type-specific limits/choices, and the per-field
  **instruction**.
- Output top: a **Structured output (default) / Template** choice (the
  conversational node's segmented approach, minus the unstructured mode).
  - **Structured:** author defines fields manually; output is the record grid
    (xlsx), no format picker.
  - **Template:** the author just uploads a `.docx`/`.xlsx`; the format is
    inferred. A note above the upload box states spreadsheets should carry a
    header row. Fields are **auto-derived** from the template's header row / `{{
    tags }}` (the same mechanism as the conversational node) and each derived
    field keeps an **editable instruction**.

### 5. Server
- `extraction.delete` — author-gated soft delete via the existing `deleteFlow`
  use case (extraction flows are `flow` rows with `flowType: "extraction"`).
- `extraction.parseOutputTemplate` — author-gated; parses an uploaded template
  through the document generator (`extractTags`/`extractFields`/`extractFullText`),
  stores it to object storage, and returns the `FlowContextDoc` plus the derived
  `TemplateField[]`, format, and spreadsheet mode. No new tables.

## Out of scope
- Publish semantics (button deliberately disabled).
- Changes to the Runs / results screens beyond reaching them from the ⋯ menu.

## Testing
- Unit: extraction-field model ↔ draft mapping and output-mode derivation
  helpers (pure functions in `extraction-editor-model.ts`).
- Component: editor renders focus overlays and toggles; delete confirm.
- E2E: `enhance-synthesise-ui.spec.ts` — list header + New; edit header Save/⋯
  (Runs, Delete) with Publish disabled; card focus toggle; output structured ↔
  template.
