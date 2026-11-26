// Run with: node --test scripts/find-template-scope-leaks.test.mjs
//
// Regression guard: validate.sh check 26 used to grep the whole working tree, so
// a gitignored local file (a developer's .claude/settings.local.json) holding the
// old scope failed the check on that machine while a fresh clone passed. Only
// files that are, or could be, committed may fail it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("find-template-scope-leaks.sh", import.meta.url));
// Assembled so this file does not itself trip the check it tests.
const oldScopeReference = `"${"@"}${"rbrasier"}/adapters"`;

let repositoryDirectory;

const runGit = (...gitArguments) =>
  execFileSync("git", gitArguments, { cwd: repositoryDirectory });

const writeRepositoryFile = (relativePath, content) => {
  const absolutePath = join(repositoryDirectory, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
};

const findLeaks = () =>
  execFileSync("bash", [scriptPath], {
    cwd: repositoryDirectory,
    encoding: "utf8",
    // Keep the developer's own global gitignore out of the fixture repo.
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
  })
    .split("\n")
    .filter(Boolean);

describe("find-template-scope-leaks.sh", () => {
  beforeEach(() => {
    repositoryDirectory = mkdtempSync(join(tmpdir(), "scope-leaks-"));
    runGit("init", "--quiet");
    writeRepositoryFile(".gitignore", ".claude/settings.local.json\n");
    writeRepositoryFile("README.md", "clean\n");
    runGit("add", ".");
    runGit("-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "init");
  });

  afterEach(() => {
    rmSync(repositoryDirectory, { recursive: true, force: true });
  });

  it("reports nothing in a clean repository", () => {
    assert.deepEqual(findLeaks(), []);
  });

  it("ignores a gitignored local file holding the old scope", () => {
    writeRepositoryFile(".claude/settings.local.json", oldScopeReference);
    assert.deepEqual(findLeaks(), []);
  });

  it("reports an untracked file that is not ignored", () => {
    writeRepositoryFile("packages/new/package.json", oldScopeReference);
    assert.deepEqual(findLeaks(), ["packages/new/package.json"]);
  });

  it("reports a tracked file", () => {
    writeRepositoryFile("README.md", oldScopeReference);
    assert.deepEqual(findLeaks(), ["README.md"]);
  });

  it("exempts docs/development/implemented/", () => {
    writeRepositoryFile("docs/development/implemented/alpha-1/v0.1.0/old.md", oldScopeReference);
    assert.deepEqual(findLeaks(), []);
  });
});
