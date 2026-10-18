# Bug fix — carry the turbo and @vitest/mocker security patches onto alpha-2

Source: Dependabot PR #328 (security group, opened against `main`). No issue.
Severity: minor — build and test tooling only; neither package ships in the runtime image.

## Symptom

`release/alpha-2` resolves `turbo@2.9.9` and `vitest`/`@vitest/mocker@4.1.8`, the
versions Dependabot's security group flags. Its fix, #328, cannot land:

- Its commit also raised `ai` from `^4.0.0` to `^7.0.141` (resolving 4.3.19 → 7.0.141)
  and every `vitest` range to `^5.0.4`, neither of which the security group lists.
  `ai` 7 drops the v4 API surface the adapters use (`LanguageModelV1`,
  `promptTokens`/`completionTokens`, `maxTokens`, `maxSteps`,
  `experimental_createMCPClient`, `toolCalls[].args`), so
  `@wayfinder/adapters#typecheck` fails with 34 errors — first:
  `src/ai/embeddings-adapter.ts(27,39): error TS2315: Type 'EmbeddingModel' is not generic.`
  Reproduced locally on `d3caa36` with `pnpm install --frozen-lockfile` and
  `tsc --noEmit` in `packages/adapters`.
- `dependabot-release-port.yml` pushed `dependabot-port/release/alpha-2/npm_and_yarn/security-33190acf22`
  but failed at `gh pr create`: `GitHub Actions is not permitted to create or approve pull requests`.
  That branch carries the same `ai` ^7 bump.

## Reproduction

```sh
git show origin/release/alpha-2:pnpm-lock.yaml | grep -E "^  (turbo|'@vitest/mocker)@"
#   '@vitest/mocker@4.1.8':
#   turbo@2.9.9:
```

## Root cause

The release line pins nothing above the flagged versions: root `turbo` is
`^2.1.0`, and `vitest` is `^4.1.0` both in every workspace and in the root
`pnpm.overrides`, so the lockfile keeps resolving 2.9.9 / 4.1.8.

## Fix plan

- Root `turbo` → `^2.9.14`.
- `vitest` and `@vitest/coverage-v8` → `^4.1.11` in every workspace, and the root
  `pnpm.overrides` `vitest` entry → `^4.1.11`, so `@vitest/mocker` (pinned by
  vitest to its own version) resolves 4.1.11 and coverage-v8 matches its vitest peer.
- Regenerate the lockfile with `pnpm install --lockfile-only`.
- `ai` stays on `^4.0.0`; the v4 → v7 migration is separate work.

## Implementation summary (v0.28.37)

**Root cause:** the release line's ranges (`turbo` `^2.1.0`, `vitest` `^4.1.0` in
every workspace and in `pnpm.overrides`) never forced a resolve past the flagged
`turbo@2.9.9` / `@vitest/mocker@4.1.8`.

**Fix applied:**
- Root `package.json`: `turbo` `^2.9.14`; `pnpm.overrides.vitest` `^4.1.11`.
- `vitest` and `@vitest/coverage-v8` `^4.1.11` in `packages/{domain,application,adapters,shared}`,
  `apps/{api,web}` and `mocks`.
- `pnpm-lock.yaml` regenerated with `pnpm install --lockfile-only`. It now resolves
  `turbo@2.9.14`, and `vitest`, `@vitest/mocker` and `@vitest/coverage-v8` at `4.1.11`;
  `ai` stays `4.3.19`. The only other lockfile change is the `vitest` peer key on
  the `better-auth@1.6.25` snapshot.
- `turbo` is locked at exactly 2.9.14, the version #328 named: a plain
  `--lockfile-only` resolve of `^2.9.14` would have taken 2.11.8.

**Regression guard:** no logic changed, so no unit test was added. The lockfile
was checked before and after (`turbo@2.9.9`/`@vitest/mocker@4.1.8` → `2.9.14`/`4.1.11`).
`./validate.sh` passed 26/26, running the full unit suite (3,831 tests) and the
coverage gate on vitest 4.1.11. `pnpm audit` (section 11) is clean. OSV-Scanner
(section 11b) and drizzle-kit check were skipped locally (no scanner, no
database) and run in CI.

**E2E:** none — dependency tooling falls in no group of `e2e-test-policy.md`.

**Not done here:** the `ai` 4 → 7 migration that #328 also carried; closing #328
and the orphaned `dependabot-port/release/alpha-2/npm_and_yarn/security-33190acf22`
branch; the repository setting that stops `dependabot-release-port.yml` from opening PRs.
