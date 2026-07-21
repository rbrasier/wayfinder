# Phase — Admin / Organisations / Groups / Flow-builder UI cleanup

- **Status**: Draft (self-reviewed; enhancement)
- **Target version**: 2.10.0 — **MINOR** (two nullable schema columns +
  new system settings; the rest is UI/behaviour).
- **Base branch**: `main` (extends unreleased 2.x org/group work).
- **Depends on**: ADR-036 (groups), ADR-038 (organisations & structured
  conversations).

## 1. Goal

A batch of UI-consistency and behaviour fixes across the admin area, the
organisation/group model, the flow-builder step config, and chat naming.

## 2. What is built

| # | Area | File(s) | Change |
|---|------|---------|--------|
| 1 | Organisations | `domain/entities/organisation-resolution.ts` | Default resolution → `self_nomination` (create_or_join). |
| 1 | Organisations | `domain/entities/organisation.ts`, `adapters/db/schema/core.ts`, `adapters/repositories/drizzle-organisation-repository.ts`, `application/use-cases/organisation/*`, `web/organisation router` | Add editable `email_domain`. |
| 1 | Organisations | new setting `organisations_enabled` (default off) | Toggle in Configuration; gates org UI. |
| 1 | Organisations | `web/settings/page.tsx` | Show `OrganisationNameCard` only when orgs OFF. |
| 1 | Organisations | chat prompt path (`route.ts`, `cached-admin-settings.ts`) | When orgs ON and user has an org, prompt uses that org's name; else the global setting. |
| 1 | Organisations | `admin/organisations/_content.tsx` | Create org via modal, not inline; edit email domain. |
| 2 | Groups | `domain/entities/group.ts`, `adapters/db/schema/admin.ts`, `adapters/repositories/drizzle-group-repository.ts`, `application/use-cases/group/*`, `web/group router` | Add nullable `organisation_id`. |
| 2 | Groups | `admin/groups/_content.tsx` | Add group via modal; org select shown when orgs enabled. |
| 3 | Publish modal | `flows/[id]/config/_flow-config-header.tsx` | `GroupVisibilityDialog` → DialogBody/CloseButton/Description for consistent padding. |
| 4 | Admin nav | `components/sidebar.tsx` | Reorder + collapse + rename groups (see §Details). |
| 5 | Configuration | `web/settings/page.tsx` + new `CollapsibleSection` | Group cards into logical collapsible sections. |
| 6 | Chat naming | `api/chat/[sessionId]/stream/execute-turn.ts`, `turn-helpers.ts` | Placeholder `"{FlowName} (new)"` on kickoff; real title on 2nd user message. |
| 7 | Structured fields | `canvas/structured-field-editor.tsx` (new), `node-config-modal-conversational.tsx`, `domain/entities/template-field.ts` (serialiser) | One-line label + type dropdown + cog config modal + remove; `?` help icon. |
| 8 | Step colour | `node-config-modal.tsx` | Move colour to a single circle at the end of the step-name row; inline overlay menu. |
| 9 | Icon picker | `flow/flow-metadata-dialog.tsx` + new `icon-picker.tsx` | "More" link opens a searchable overlay across a large icon set. |

## 3. Database changes

One migration adds two nullable columns:
- `core_organisations.email_domain text` (nullable).
- `admin_groups.organisation_id uuid` nullable, FK → `core_organisations(id)` `on delete set null`.

Settings (`organisations_enabled`) use `admin_system_settings` (no DDL).

## 4. Implementation order (tests first for logic)

1. Domain: default resolution; organisation `email_domain`; group
   `organisationId`; `templateFieldToLine` serialiser (unit tests first).
2. Adapters: schema + repositories + migration.
3. Application: create/update use cases thread the new fields.
4. Web routers: organisation/group input schemas; settings key.
5. Web UI: items 1f, 2a/2b, 3, 4, 5, 6, 7, 8, 9.
6. Playwright e2e covering the admin-menu order + create-org modal.

## 5. Risks / open questions

- Prompt org resolution must not add a per-turn DB round-trip on the hot path —
  reuse the already-loaded user record.
- Structured-field serialiser must round-trip through `parseTemplateField` so
  stored `structuredFields[].raw` stays valid.
</content>
</invoke>
