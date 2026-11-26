# Dependabot fix: actions group bump + bundled web fonts (v0.41.13)

- **PR**: #409, `chore(deps): Bump the actions group with 2 updates`
  (`pnpm/action-setup` 6.1.0 → 6.1.1, `actions/dependency-review-action` 5.0.0 → 5.0.1)
- **Base**: `release/alpha-3`, head `dependabot/github_actions/release/alpha-3/actions-2e8a8db8e8`
- **Version**: PATCH 0.41.12 → 0.41.13

## What was wrong

- **Version clash, not a red check.** Every check passed on the PR's head. The PR
  carried 0.41.11, but #408 merged first with that same version, and #411 then took
  0.41.12. Git merged the identical `VERSION` edit cleanly, so the PR would have
  landed with no PATCH bump of its own. GitHub reported it as `blocked`, because it
  was behind its base.
- **Google Fonts fetched at build time** (added at the maintainer's request). The
  web app loaded Figtree and JetBrains Mono through `next/font/google`, which
  downloads them during `next build`. When that download fails, the build stops:

  ```
  @wayfinder/web:build: An error occurred in `next/font`.
  TypeError: Cannot read properties of null (reading '1')
      at .../@next/font/dist/google/loader.js:122:78
  ```

  It failed "Signature engine (DSS)" and "Playwright E2E (PKI client
  certificates)" on #408 (run 45583548272), and DSS again on #411 (runs
  45807918037 and 45805625767). Each time the failure was in the web build, which
  none of those PRs touched.

## Fix

- Merged `release/alpha-3` into the branch, so it now includes #408 and #411.
  Resolved `VERSION` and root `package.json` to 0.41.13, the next PATCH above the
  base's 0.41.12.
- Bundled the fonts: the Latin variable-weight WOFF2 files from Fontsource 5.3.0
  (the same Google Fonts builds, OFL-1.1, licences alongside) now live in
  `apps/web/src/app/fonts/`. `layout.tsx` loads them with `next/font/local`, using
  the same `--font-figtree` / `--font-jetbrains-mono` variables, so no styles
  change. The weight ranges are each font's full axis (Figtree 300–900, JetBrains
  Mono 100–800); every weight the app used before is inside them.
- The dependency bumps are kept as Dependabot raised them.

## How it was checked

- `apps/web/src/app/fonts.test.ts`, written first. It failed 5 of 5 before the
  change and passes 5 of 5 after. It asserts that no source file imports
  `next/font/google`, that both files are WOFF2, and that both licences are
  present.
- `pnpm --filter @wayfinder/web build` succeeds locally. The built CSS defines both
  font variables from `/_next/static/media/*.woff2`, with no Google URLs.
- On the pushed font commit (before the version merge), the full CI and e2e suites
  passed, including the PKI e2e job, which builds the web app.
- `./validate.sh` passes after the merge.
