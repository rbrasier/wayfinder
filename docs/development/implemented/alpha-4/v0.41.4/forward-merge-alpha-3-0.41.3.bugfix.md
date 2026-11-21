# Forward merge — `release/alpha-3` 0.41.3 into `main` (v0.41.4)

## Approved change summary

Periodic forward merge of `release/alpha-3` into `main`, as described in
[`managing-releases.md`](../../../../guides/managing-releases.md) and `/release`
Operation C. Shipped as a patch bump (0.41.3 → 0.41.4) so the merge-back is traceable
like any bugfix.

## What came across

Everything on `release/alpha-3` since the previous forward merge (v0.41.3, PR #387):

| Release-line change | Release PR | Trace doc on `release/alpha-3` |
|---|---|---|
| Local embeddings and pino-pretty work again in the bundled web app — Node's real `createRequire` is reached through a default import of `node:module`, and the `next.config.ts` warning suppression is removed | #395 | [`alpha-3/v0.41.3/next-bundled-create-require.bugfix.md`](../../alpha-3/v0.41.3/next-bundled-create-require.bugfix.md) |
| Five experimental features (`flow_memory`, `flow_test_runs`, `view_as_user`, `flow_portability`, `lookup_sources`) behind default-off feature flags; the flow editor's **Triggers** button and endpoints require `flow:webhook_trigger` (admins always pass) | #396 | [`alpha-3/v0.41.3/alpha-3-experimental-flags.phase.md`](../../alpha-3/v0.41.3/alpha-3-experimental-flags.phase.md), [`…summary.md`](../../alpha-3/v0.41.3/alpha-3-experimental-flags.summary.md) |
| `pnpm/action-setup` bump in CI, e2e and the Dependabot release-port workflows | #391 | — (Dependabot) |

The release line's trace docs come across unchanged under `implemented/alpha-3/v0.41.3/`,
where they were written; this file is the `main`-side record of the merge.

## Integrity of `main`

`main` had diverged from the release line only by line-opening bookkeeping and earlier
forward-merge records, so the merge applied with no conflicts and no adaptation.

- **The experimental flags default off on `main` too.** That is deliberate: `main` must
  not regress behind the release line, and the gates (server and UI) are the release
  line's behaviour. Whether a flag graduates to default-on for alpha-4 is a product
  decision for a later `/enhance` on `main` — flip its entry in
  `DEFAULT_FEATURE_FLAGS` (`packages/application/src/use-cases/get-feature-flag.ts`).
- The e2e seed (`apps/web/src/lib/e2e-fixtures.ts`) enables the five flags, so `main`'s
  e2e specs keep exercising those features.
- No schema change and no migration on either side.

## Deliberately not taken

Nothing. Every commit applies to `main` as-is.

## Version

0.41.3 → **0.41.4** (patch; no schema impact). `VERSION` and `package.json` match.

`release/alpha-3` also sits at 0.41.3, so its next patch will reuse 0.41.4. The docs
folder (`alpha-3/` vs `alpha-4/`) and branch tell the two apart, as with the previous
forward merges.
