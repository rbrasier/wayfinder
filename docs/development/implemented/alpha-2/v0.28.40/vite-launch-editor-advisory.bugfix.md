# Bug fix: clear the vite launch-editor advisory blocking validate.sh on alpha-2

Source: maintainer request. `./validate.sh` on `release/alpha-2` failed its dependency
audit. No issue.
Severity: minor. The advisory affects the vite dev server on Windows only; vite is a
dev/test dependency, not shipped in the container image. It still blocked every
`validate.sh` run and the CI audit gate.

## Symptom

`./validate.sh` on `release/alpha-2` (0.28.39) failed section 11:

```
Blocking advisories:
high — vite — GHSA-587h-7wmj-h5pm — launch-editor: `fs.existsSync()` existence check can be bypassed on Windows
```

## Root cause

The root `pnpm.overrides` held vite at `^6`, which resolved `6.4.3`. GHSA-587h-7wmj-h5pm
affects `<=6.4.3` and is fixed in `6.4.4`. Every vite in the tree comes from the
override (directly in the workspace packages, and through `vitest` → `@vitest/mocker`).

## Fix

- **Override:** raise the root `pnpm.overrides` entry for `vite` from `^6` to `^6.4.4`,
  keeping it on major 6. It now resolves to `6.4.5`.
- **Lockfile:** regenerated with `pnpm install`. The only change is vite 6.4.3 → 6.4.5
  and the specifier.

- **E2E package:** CI's OSV scan then flagged `follow-redirects` 1.16.0 in
  `apps/web/e2e/package-lock.json` (GHSA-8r9p-f939-6h3c, GHSA-q3jh-wrc6-jgq8,
  published after the base went green). Add an `overrides` entry
  `follow-redirects: ^1.16.1` beside the existing `axios`/`form-data`/`joi` ones and
  refresh that lockfile with `npm install --package-lock-only`.

No allow-list entry: a patched release exists for each.

## Implementation summary (v0.28.40)

- **Files:** `package.json` (override and version), `pnpm-lock.yaml`, `VERSION`,
  `apps/web/e2e/package.json` and `apps/web/e2e/package-lock.json`.
- **Verification:** `./scripts/audit-check.sh` now reports no blocking advisories (the
  existing `braces` allow-list entry still applies), and `./validate.sh` exits 0.
- **Version:** PATCH, 0.28.39 → 0.28.40.
- **Known limitations:** none.
