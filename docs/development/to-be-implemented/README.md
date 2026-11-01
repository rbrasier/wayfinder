# `to-be-implemented/`

This directory holds **phase docs** awaiting implementation.

## Lifecycle

1. The "New App / Feature Setup" skill creates a new file here, e.g.
   `phase-2-knowledge-base.md`.
2. The "Documentation Review" skill reads it and reports PASS / WARN / FAIL.
3. The "Build — New Phase or Feature" skill implements it, then **moves the
   file** to `docs/development/implemented/<release line>/v<version>/` and
   writes an implementation summary alongside.

   The release line is **not** tied to a version number. It comes from the
   branch being worked on — `release/alpha-3` → `alpha-3`, `main` → the next
   release line named in [`CLAUDE.md`](../../../CLAUDE.md). MINOR and PATCH
   count up continuously across lines, so a line never owns a version range.
   See [`versioning.md`](../../guides/versioning.md).
4. `validate.sh` fails if any file in this directory is referenced (by
   filename) inside `implemented/`. That would mean it should have been
   moved.

This directory is intentionally empty in a fresh checkout. The initial
scaffold (v0.1.0) was completed when the template was bootstrapped — its
phase doc and implementation summary live in
`../implemented/alpha-1/v0.1/`.

See `docs/guides/skills.md` for the full skill workflow.
