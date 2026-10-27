import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The Semgrep step ran semgrep/semgrep-action@v1, which ships Semgrep 1.36. That
// version cannot parse the MEDIUM severity the current registry packs use, so it
// crashed while loading rules — and the action still reported success. The scan
// had not run for as long as nobody read the log. The gate is now a script whose
// exit code is the scanner's verdict, and in CI anything but a completed scan fails.

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const scriptPath = join(repositoryRoot, "scripts", "semgrep-check.sh");

const SEVERITY_CRASH = `
echo 'Traceback (most recent call last):' >&2
echo 'ValueError: invalid rule severity value: MEDIUM' >&2
exit 2
`;

// A stub semgrep on an otherwise-empty PATH directory stands in for the scanner,
// so each case controls exactly what the scanner reports.
const stubBinDirectory = (semgrepBody?: string): string => {
  const binDirectory = mkdtempSync(join(tmpdir(), "semgrep-check-"));
  if (semgrepBody === undefined) return binDirectory;
  const stubPath = join(binDirectory, "semgrep");
  writeFileSync(stubPath, `#!/usr/bin/env bash\n${semgrepBody}\n`);
  chmodSync(stubPath, 0o755);
  return binDirectory;
};

// bash and the coreutils the script needs, without whatever semgrep the
// developer may have installed.
const SYSTEM_PATH = "/usr/bin:/bin";

const runGate = (semgrepBody: string | undefined, ci: boolean) => {
  const result = spawnSync("bash", [scriptPath], {
    encoding: "utf8",
    env: {
      PATH: `${stubBinDirectory(semgrepBody)}:${SYSTEM_PATH}`,
      ...(ci ? { CI: "true" } : {}),
    },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

describe("semgrep-check.sh", () => {
  it("fails in CI when the scanner crashes loading the rule packs", () => {
    const { status, output } = runGate(SEVERITY_CRASH, true);

    expect(status).toBe(1);
    expect(output).toContain("invalid rule severity value: MEDIUM");
  });

  it("fails when the scan reports findings", () => {
    const { status } = runGate('echo "1 blocking finding"; exit 1', true);

    expect(status).toBe(1);
  });

  it("passes a clean scan", () => {
    const { status } = runGate("exit 0", true);

    expect(status).toBe(0);
  });

  it("passes the pinned rule packs and the blocking flag to the scanner", () => {
    const { output } = runGate('echo "ARGS: $*"; exit 0', true);

    expect(output).toMatch(/ARGS: scan .*--error/);
    expect(output).toContain("--config p/typescript");
    expect(output).toContain("--config p/owasp-top-ten");
  });

  it("fails in CI when semgrep is not installed", () => {
    const { status } = runGate(undefined, true);

    expect(status).toBe(1);
  });

  it("skips locally when semgrep is not installed", () => {
    const { status, output } = runGate(undefined, false);

    expect(status).toBe(0);
    expect(output).toMatch(/^SKIP —/m);
  });

  it("skips locally when the scanner cannot run", () => {
    const { status, output } = runGate(SEVERITY_CRASH, false);

    expect(status).toBe(0);
    expect(output).toMatch(/^SKIP —/m);
  });
});

describe("CI security job", () => {
  const workflow = readFileSync(join(repositoryRoot, ".github", "workflows", "ci.yml"), "utf8");

  it("no longer runs the deprecated semgrep action", () => {
    expect(workflow).not.toMatch(/uses:\s*semgrep\/semgrep-action/);
  });

  it("runs the shared Semgrep gate on a pinned CLI version", () => {
    expect(workflow).toContain("./scripts/semgrep-check.sh");
    expect(workflow).toMatch(/SEMGREP_VERSION: "?\d+\.\d+\.\d+"?/);
  });
});
