# ADR-005 — Two-Surface Route Groups & Role Model

- **Status**: Accepted
- **Date**: 2026-05-19

## Context

Wayfinder has two distinct user surfaces:

- An **end-user** experience — session list (`/chats`) and the conversational
  chat (`/chats/[sessionId]`).
- An **admin / flow-owner** experience — flow listing (`/admin/flows`),
  canvas (`/admin/flows/[id]`), and the cross-organisation session view
  (`/admin/sessions`).

These have different auth requirements (admin pages require an admin role),
different UI paradigms (chat vs. infinite canvas), and partially different
data access rules (an admin can view all sessions; a normal user cannot).

The existing template already organises pages into `(user)` and `(admin)`
Next.js route groups (see `apps/web/src/app/`). Wayfinder extends this rather
than introducing a third surface.

There is also a third category of user — a **flow owner** — which is not a
global role but a per-flow permission. A flow owner can edit the canvas for
their flows, even though they have the global `user` role.

## Decision

### Route groups

- `(user)/chats/*` — session list and chat interface, available to any
  authenticated user.
- `(user)/flows/[id]/config` — canvas, available only when the user has
  `owner` permission on the flow (enforced by tRPC middleware, not by route
  group middleware, because the check is per-resource).
- `(admin)/admin/flows/*` — flow management, available to global admins.
- `(admin)/admin/sessions` — cross-user session view, available to global
  admins.

Existing admin pages (`/admin/users`, `/admin/errors`, etc.) remain in the
`(admin)` group untouched.

### Role model

Two **global roles**, stored as a column on `core_users` (extending the
existing `is_admin` boolean):

| Role    | Stored as            | Granted by             |
| ------- | -------------------- | ---------------------- |
| `admin` | `is_admin = true`    | `ADMIN_SEED_EMAIL` or another admin |
| `user`  | `is_admin = false`   | Default on JIT provision |

One **per-flow permission**, stored in `app_flow_permissions`:

| Permission | Meaning                                              |
| ---------- | ---------------------------------------------------- |
| `owner`    | Can edit the canvas, upload context docs, publish    |
| `viewer`   | (reserved) Can see the canvas read-only — Phase 4+   |

`owner` is granted by an admin or by being the user who created the flow.
The flow's `owner_user_id` column is the canonical creator; additional owners
are rows in `app_flow_permissions`.

### JWT claim shape

The session JWT carries:

```typescript
{
  sub: string;          // user id
  email: string;
  role: 'admin' | 'user';
}
```

`flowPermissions` is **not** put in the JWT — it's fetched per request from
`app_flow_permissions` because it can change without re-issuing tokens.

### Enforcement

- `apps/web/src/middleware.ts` enforces the route-group rule: `(admin)/*`
  requires `role === 'admin'`. Non-admins get a `403` JSON for API routes and
  a redirect to `/chats` for page routes.
- tRPC middleware in `flow.update`, `flow.uploadContextDoc`, `flow.publish`
  checks `flow_permissions[flowId] === 'owner'` OR `role === 'admin'`. Returns
  `FORBIDDEN` on failure.
- tRPC middleware in `session.list` filters by `user_id` unless
  `role === 'admin'`. Admins see all rows.

## Consequences

**Positive**

- One Next.js deployment, two cleanly-separated surfaces.
- The global role check stays cheap (in the JWT, no DB lookup) for the bulk
  of requests.
- Per-flow `owner` is a small, focused table that can grow into other
  permission kinds without changing the role model.

**Negative**

- Per-request DB lookup for flow permissions adds a query to every canvas
  mutation. Acceptable at MVP scale; cache later if it becomes hot.
- Two enforcement layers (middleware + tRPC). Tests must cover both to avoid
  drift; a forgotten check in tRPC could be hidden by a middleware check.

## Alternatives considered

- **Single role table with arbitrary permissions** — overkill at MVP, and the
  existing `is_admin` boolean is already wired through Better Auth and the
  admin dashboard. Reuse beats rework.
- **Put `flowPermissions` in the JWT** — would mean re-issuing tokens whenever
  ownership changes. Rejected for the operational cost.
