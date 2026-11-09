# Forward merge — `release/alpha-3` docs pin into `main` (v0.41.3)

## Approved change summary

Periodic forward merge of `release/alpha-3` into `main`, as described in
[`managing-releases.md`](../../../../guides/managing-releases.md). Shipped as a
patch bump (0.41.2 → 0.41.3) so the merge-back is traceable like any bugfix.

## What came across

One commit since the previous forward merge (v0.41.2): `docs: pin deployment guides to v0.41.1`.

- `docs/guides/setup-aws.md`, `setup-azure.md`, `upgrading.md` — example image tags
  moved from the stale `0.28.44` to `0.41.1`, the latest published image, plus the
  upgrade-path sentence in `upgrading.md`.

No application code, schema or tests changed.

## Deliberately not taken

Nothing needed excluding; the commit touches only these three guides, none of which
carry alpha-4 pointers.

## Version

0.41.2 → **0.41.3** (patch; no schema impact). `VERSION` and `package.json` match.
