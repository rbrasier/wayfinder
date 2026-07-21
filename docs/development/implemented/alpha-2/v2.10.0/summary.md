# v2.10.0 — Admin / Organisations / Groups / Flow-builder UI cleanup

**Version bump:** MINOR (2.9.0 → 2.10.0). Two nullable schema columns +
new system settings; the rest is UI/behaviour.

**Migration:** `packages/adapters/drizzle/0036_stormy_gorgon.sql`
- `core_organisations.email_domain text` (nullable)
- `admin_groups.organisation_id uuid` (nullable, FK → `core_organisations`, `on delete set null`)

## What changed

1. **Organisations**
   - Default membership resolution is now **self-nomination** (create or join).
   - New master toggle `organisations_enabled` (**off by default**). When off,
     the Organisations nav item is hidden, `organisation.mine` returns null, and
     no membership resolution runs on sign-in.
   - The global **Organisation name** setting shows only when organisations are
     **off**; when on, a member's chat prompt resolves to their own
     organisation's name.
   - Organisations carry an editable **email domain**.
   - Creating an organisation is a **modal**, not an inline header field.

2. **Groups**
   - Adding a group is a **modal**.
   - A group can be associated with an **organisation** (when the feature is on)
     or left **global** (default).

3. **Publish-to-groups modal** restyled with `DialogBody` / `DialogCloseButton`
   / `DialogDescription` for consistent padding.

4. **Admin sidebar** — "Users and Roles" (was "User Admin") moved above
   "Advanced Flow Settings" (was "Flow Settings"); both collapsed by default;
   admin "Flows" renamed to "All Flows".

5. **Configuration page** grouped into collapsible sections (General, AI,
   Integrations, Storage & uploads, Notifications, Directory & security).

6. **Chat naming** — a new chat shows the placeholder `"{Flow} (new)"` after the
   kickoff turn, and the real AI-generated title is set on the **first real user
   message** (the second user message).

7. **Structured conversation fields** — each field is now one row: a label, a
   type dropdown, a per-field **config cog** (required/optional, limits, choices)
   and a remove button, plus a `?` help icon opening the shared field-types
   explainer. Backed by a new domain serialiser `templateFieldToLine`.

8. **Step colour** moved to a single circle at the end of the step-name row that
   opens an inline colour menu.

9. **New-flow icon picker** gains a **"More…"** link opening a searchable overlay
   across a large icon set.

## Tests

- Unit: domain `templateFieldToLine` round-trip; `maybeUpdateSessionTitle`
  (placeholder on kickoff, generate on 2nd message, respect manual rename);
  `ResolveOrganisationOnSignIn` no-op when organisations disabled;
  `cached-admin-settings` organisations-enabled read.
- E2E (`/e2e` MCP skill, excluded from vitest):
  `apps/web/e2e/enhance-admin-orgs-ui-cleanup.spec.ts` covers the renamed/
  reordered admin nav, the grouped Configuration sections + organisations
  toggle, and creating an organisation through the modal.
  `phase-structured-conversation.spec.ts` updated for the new structured editor.
</content>
