# Bug Fix: Directory Empty Check Fails on macOS Due to .DS_Store

## Root Cause

`packages/create/src/index.ts` line 235-236 uses `readdirSync(targetDir)` and
checks `entries.length > 0` to decide if the target directory is empty.
`readdirSync` returns hidden files — on macOS, Finder automatically creates
`.DS_Store` in every directory the user opens. This causes the bootstrapper to
reject a visually-empty directory.

## Reproduction Steps

1. Create a new empty directory on macOS.
2. Open it in Finder (which creates `.DS_Store`).
3. `cd` into the directory.
4. Run `pnpm create ai-app-template`.
5. Observe: "Target directory is not empty" despite `ls` returning nothing.

## Fix Plan

1. Extract the emptiness check into a new `isDirectoryEmpty(dirPath)` helper in
   `packages/create/src/helpers.ts`.
2. Filter out a known set of OS-generated files (`.DS_Store`, `Thumbs.db`,
   `.Spotlight-V100`, `.Trashes`) before deciding the directory is non-empty.
3. Add unit tests to `helpers.test.ts` covering: truly empty dir, dir with only
   `.DS_Store`, dir with only `Thumbs.db`, dir with a real file, dir with both.
4. Replace the inline check in `index.ts` with the new helper.

## Version Bump

PATCH: `0.5.1` → `0.5.2`

---

## Implementation Summary

**Root cause confirmed**: `readdirSync` returns hidden OS files. On macOS, Finder
writes `.DS_Store` into every directory it opens, so any user who navigated to
their new empty directory via Finder would hit this error.

**Fix applied**:
- Added `isDirectoryEmpty(dirPath)` to `packages/create/src/helpers.ts`. It
  reads directory entries and returns `true` only if every entry is in the
  `IGNORED_ENTRIES` set (`.DS_Store`, `Thumbs.db`, `.Spotlight-V100`, `.Trashes`).
- Replaced the inline `readdirSync` + length check in `index.ts:scaffold()` with
  a call to `isDirectoryEmpty`.
- Removed the now-unused `readdirSync` import from `index.ts`.

**Regression test added** (`packages/create/src/helpers.test.ts`):
- Returns `true` for a truly empty directory
- Returns `true` when only `.DS_Store` is present
- Returns `true` when only `Thumbs.db` is present
- Returns `false` when a real file is present
- Returns `false` when a real file and `.DS_Store` are both present
