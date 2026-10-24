// Run with: node --test scripts/waiver-rules.test.mjs
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assessWaiver,
  compareVersions,
  parseAllowedAdvisories,
  parseLockfileVersions,
  parseTrivyIgnoreIds,
  unlinkedTrivyIds,
  waiverAdvisoryFromOsv,
} from "./waiver-rules.mjs";

describe("compareVersions", () => {
  it("orders versions numerically, part by part", () => {
    assert.ok(compareVersions("3.25.76", "4.6.6") < 0);
    assert.ok(compareVersions("4.10.0", "4.9.9") > 0);
    assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
  });
});

describe("assessWaiver", () => {
  const zodOnlyOnFour = [{ packageName: "zod", introduced: "0", fixed: "4.6.6" }];

  it("is still needed while the only fix is a new major the project cannot take", () => {
    const assessment = assessWaiver({ ranges: zodOnlyOnFour, resolved: { zod: ["3.25.76", "4.6.6"] } });

    assert.deepEqual(assessment, { status: "needed", upgrades: [] });
  });

  it("is still needed while no fix has been published at all", () => {
    const assessment = assessWaiver({
      ranges: [{ packageName: "braces", introduced: "0", fixed: null }],
      resolved: { braces: ["3.0.3"] },
    });

    assert.equal(assessment.status, "needed");
  });

  it("must give way to an upgrade once a fix lands within the major already in use", () => {
    const backported = [
      { packageName: "zod", introduced: "0", fixed: "3.25.77" },
      { packageName: "zod", introduced: "4.0.0", fixed: "4.6.6" },
    ];

    const assessment = assessWaiver({ ranges: backported, resolved: { zod: ["3.25.76", "4.6.6"] } });

    assert.deepEqual(assessment, { status: "fixable", upgrades: [{ packageName: "zod", from: "3.25.76", to: "3.25.77" }] });
  });

  it("is stale once every resolved copy is outside the vulnerable ranges", () => {
    const backported = [
      { packageName: "zod", introduced: "0", fixed: "3.25.77" },
      { packageName: "zod", introduced: "4.0.0", fixed: "4.6.6" },
    ];

    assert.equal(assessWaiver({ ranges: backported, resolved: { zod: ["3.25.80", "4.7.0"] } }).status, "stale");
  });

  it("does not count a version below where the vulnerability was introduced", () => {
    const assessment = assessWaiver({
      ranges: [{ packageName: "braces", introduced: "2.0.0", fixed: "2.1.3" }],
      resolved: { braces: ["1.8.5"] },
    });

    assert.equal(assessment.status, "stale");
  });

  it("is stale once the vulnerable package has left the lockfile", () => {
    assert.equal(assessWaiver({ ranges: zodOnlyOnFour, resolved: {} }).status, "stale");
  });
});

describe("parseAllowedAdvisories", () => {
  it("reads the waived ids from the allowlist array", () => {
    const script = `# GHSA-zzzz-zzzz-zzzz mentioned in a comment\nALLOWED_ADVISORIES=(\n  "GHSA-vfj7-8cjw-p6xm"\n  "GHSA-mrhx-c7xc-m3w5"\n)\n`;

    assert.deepEqual(parseAllowedAdvisories(script), ["GHSA-vfj7-8cjw-p6xm", "GHSA-mrhx-c7xc-m3w5"]);
  });
});

describe("parseTrivyIgnoreIds", () => {
  it("reads one id per line and skips comments and blanks", () => {
    assert.deepEqual(parseTrivyIgnoreIds("# heading\n\nCVE-2023-54404\n  # note\nGHSA-abcd-efgh-ijkl\n"), [
      "CVE-2023-54404",
      "GHSA-abcd-efgh-ijkl",
    ]);
  });
});

describe("parseLockfileVersions", () => {
  it("collects every resolved version of each package", () => {
    const lockfile = `lockfileVersion: '9.0'\n\npackages:\n\n  zod@3.25.76:\n    resolution: {integrity: sha512-a}\n\n  zod@4.6.6:\n    resolution: {integrity: sha512-b}\n\n  '@scope/pkg@1.2.3':\n    resolution: {integrity: sha512-c}\n\nsnapshots:\n\n  zod@3.25.76: {}\n`;

    assert.deepEqual(parseLockfileVersions(lockfile), { zod: ["3.25.76", "4.6.6"], "@scope/pkg": ["1.2.3"] });
  });
});

describe("unlinkedTrivyIds", () => {
  it("lets the image gate waive only what the lockfile gates waive, so the two expire together", () => {
    const advisories = [{ ghsaId: "GHSA-mrhx-c7xc-m3w5", cveId: "CVE-2023-54404" }];

    assert.deepEqual(unlinkedTrivyIds(["CVE-2023-54404", "CVE-2024-00001"], advisories), ["CVE-2024-00001"]);
  });
});

describe("waiverAdvisoryFromOsv", () => {
  it("reads the fixed versions per npm package, and the CVE alias", () => {
    const record = {
      id: "GHSA-mrhx-c7xc-m3w5",
      aliases: ["CVE-2023-54404"],
      affected: [
        {
          package: { ecosystem: "npm", name: "zod" },
          ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.6.6" }] }],
        },
        { package: { ecosystem: "PyPI", name: "zod" }, ranges: [{ type: "ECOSYSTEM", events: [{ fixed: "9.9.9" }] }] },
      ],
    };

    assert.deepEqual(waiverAdvisoryFromOsv(record), {
      ghsaId: "GHSA-mrhx-c7xc-m3w5",
      cveId: "CVE-2023-54404",
      ranges: [{ packageName: "zod", introduced: "0", fixed: "4.6.6" }],
    });
  });

  it("splits a record with backports into one range per line", () => {
    const record = {
      id: "GHSA-mh99-v99m-4gvg",
      aliases: [],
      affected: [
        {
          package: { ecosystem: "npm", name: "brace-expansion" },
          ranges: [{ events: [{ introduced: "0" }, { fixed: "1.1.17" }, { introduced: "2.0.0" }, { fixed: "2.1.3" }] }],
        },
      ],
    };

    assert.deepEqual(waiverAdvisoryFromOsv(record).ranges, [
      { packageName: "brace-expansion", introduced: "0", fixed: "1.1.17" },
      { packageName: "brace-expansion", introduced: "2.0.0", fixed: "2.1.3" },
    ]);
  });

  it("records a package with no fix yet", () => {
    const record = {
      id: "GHSA-vfj7-8cjw-p6xm",
      aliases: [],
      affected: [{ package: { ecosystem: "npm", name: "braces" }, ranges: [{ events: [{ introduced: "0" }] }] }],
    };

    assert.deepEqual(waiverAdvisoryFromOsv(record).ranges, [{ packageName: "braces", introduced: "0", fixed: null }]);
  });
});
