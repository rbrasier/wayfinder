import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALPHA_2_MIGRATIONS,
  MAIN_MIGRATIONS,
  planReleaseLineReconciliation,
  type JournalMigration,
} from "./release-line-reconciliation";
import { resolveMigrationsFolder } from "./migrate";

const migration = (folderMillis: number): JournalMigration => ({
  folderMillis,
  hash: `hash-${folderMillis}`,
  sql: [`-- statement for ${folderMillis}`],
});

// The tail of main's journal that an alpha-2 database has to be brought through,
// in journal order. Shared migrations before the fork are modelled by one entry.
const SHARED_BEFORE_FORK = 1_786_000_000_000;
const MAIN_FLOW_TEST_RUNS = 1_786_915_682_440;
const mainJournal: JournalMigration[] = [
  migration(SHARED_BEFORE_FORK),
  migration(MAIN_FLOW_TEST_RUNS),
  migration(MAIN_MIGRATIONS.sessionManualEstimate),
  migration(MAIN_MIGRATIONS.welcomeTour),
  migration(MAIN_MIGRATIONS.mcpPublicDataReaders),
  migration(MAIN_MIGRATIONS.unattendedAutomation),
  migration(MAIN_MIGRATIONS.seedUnattendedAutomation),
  migration(MAIN_MIGRATIONS.entraAccountIdOid),
  migration(MAIN_MIGRATIONS.mcpOAuthClientCredentials),
  migration(MAIN_MIGRATIONS.globalAdminRoleName),
];

const fullyMigratedAlpha2Ledger = new Set<number>([SHARED_BEFORE_FORK, ...Object.values(ALPHA_2_MIGRATIONS)]);

const stepSummary = (steps: ReturnType<typeof planReleaseLineReconciliation>) =>
  steps.map((step) => (step.kind === "carry" ? `carry:${step.reason}` : `${step.kind}:${step.migration.folderMillis}`));

describe("planReleaseLineReconciliation", () => {
  it("does nothing for a database that has only ever run main's migrations", () => {
    const mainLedger = new Set([SHARED_BEFORE_FORK, MAIN_FLOW_TEST_RUNS]);

    const steps = planReleaseLineReconciliation(mainJournal, mainLedger);

    expect(steps).toEqual([]);
  });

  it("does nothing for a fresh database, leaving drizzle to migrate it", () => {
    const steps = planReleaseLineReconciliation(mainJournal, new Set());

    expect(steps).toEqual([]);
  });

  it("does nothing for an alpha-2 database from before the lines diverged", () => {
    const steps = planReleaseLineReconciliation(mainJournal, new Set([SHARED_BEFORE_FORK]));

    expect(steps).toEqual([]);
  });

  it("brings a fully migrated alpha-2 database through every main migration in journal order", () => {
    const steps = planReleaseLineReconciliation(mainJournal, fullyMigratedAlpha2Ledger);

    expect(stepSummary(steps)).toEqual([
      `apply:${MAIN_FLOW_TEST_RUNS}`,
      `record:${MAIN_MIGRATIONS.sessionManualEstimate}`,
      `record:${MAIN_MIGRATIONS.welcomeTour}`,
      `apply:${MAIN_MIGRATIONS.mcpPublicDataReaders}`,
      "carry:alpha-2 MCP bearer tokens",
      `record:${MAIN_MIGRATIONS.unattendedAutomation}`,
      `record:${MAIN_MIGRATIONS.seedUnattendedAutomation}`,
      `record:${MAIN_MIGRATIONS.entraAccountIdOid}`,
      `record:${MAIN_MIGRATIONS.mcpOAuthClientCredentials}`,
      `record:${MAIN_MIGRATIONS.globalAdminRoleName}`,
    ]);
  });

  it("moves alpha-2's encrypted bearer tokens into main's column before dropping the old one", () => {
    const steps = planReleaseLineReconciliation(mainJournal, fullyMigratedAlpha2Ledger);

    const carry = steps.find((step) => step.kind === "carry");

    expect(carry?.kind === "carry" && carry.statements.join("\n")).toMatch(
      /SET "credential_ciphertext" = "credential_encrypted"[\s\S]*DROP COLUMN "credential_encrypted"/,
    );
  });

  it("renames alpha-2's OAuth client secret column instead of adding main's empty one", () => {
    const steps = planReleaseLineReconciliation(mainJournal, fullyMigratedAlpha2Ledger);

    const oauth = steps.find(
      (step) => step.kind === "record" && step.migration.folderMillis === MAIN_MIGRATIONS.mcpOAuthClientCredentials,
    );

    expect(oauth?.kind === "record" && oauth.preparation.join("\n")).toMatch(
      /RENAME COLUMN "oauth_client_secret_encrypted" TO "oauth_client_secret_ciphertext"/,
    );
  });

  it("applies a main migration whose alpha-2 counterpart the database never ran", () => {
    const partlyMigratedAlpha2Ledger = new Set([
      SHARED_BEFORE_FORK,
      ALPHA_2_MIGRATIONS.sessionManualEstimate,
      ALPHA_2_MIGRATIONS.welcomeTour,
    ]);

    const steps = planReleaseLineReconciliation(mainJournal, partlyMigratedAlpha2Ledger);

    expect(stepSummary(steps)).toEqual([
      `apply:${MAIN_FLOW_TEST_RUNS}`,
      `record:${MAIN_MIGRATIONS.sessionManualEstimate}`,
      `record:${MAIN_MIGRATIONS.welcomeTour}`,
      `apply:${MAIN_MIGRATIONS.mcpPublicDataReaders}`,
      `apply:${MAIN_MIGRATIONS.unattendedAutomation}`,
      `apply:${MAIN_MIGRATIONS.seedUnattendedAutomation}`,
      `apply:${MAIN_MIGRATIONS.entraAccountIdOid}`,
      `apply:${MAIN_MIGRATIONS.mcpOAuthClientCredentials}`,
      `apply:${MAIN_MIGRATIONS.globalAdminRoleName}`,
    ]);
  });

  it("plans nothing on a second run, once every main migration is recorded", () => {
    const reconciledLedger = new Set([...fullyMigratedAlpha2Ledger, ...mainJournal.map((entry) => entry.folderMillis)]);

    const steps = planReleaseLineReconciliation(mainJournal, reconciledLedger);

    expect(steps).toEqual([]);
  });
});

type JournalEntry = { tag: string; when: number };

const readJournal = (folder: string): JournalEntry[] =>
  (JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as { entries: JournalEntry[] }).entries;

describe("release-line migration constants", () => {
  const mainFolder = resolveMigrationsFolder();
  const alpha2Folder = join(mainFolder, "..", "drizzle-fixtures", "alpha-2");

  it("name main migrations that exist in main's journal under the expected tags", () => {
    const tagsByWhen = new Map(readJournal(mainFolder).map((entry) => [entry.when, entry.tag]));

    expect(tagsByWhen.get(MAIN_MIGRATIONS.sessionManualEstimate)).toBe("0046_session_manual_estimate");
    expect(tagsByWhen.get(MAIN_MIGRATIONS.welcomeTour)).toBe("0049_welcome_tour");
    expect(tagsByWhen.get(MAIN_MIGRATIONS.mcpPublicDataReaders)).toBe("0055_mcp_public_data_readers");
    expect(tagsByWhen.get(MAIN_MIGRATIONS.unattendedAutomation)).toBe("0057_unattended_automation");
    expect(tagsByWhen.get(MAIN_MIGRATIONS.seedUnattendedAutomation)).toBe("0058_seed_unattended_automation");
    expect(tagsByWhen.get(MAIN_MIGRATIONS.entraAccountIdOid)).toBe("0059_entra_account_id_oid");
    expect(tagsByWhen.get(MAIN_MIGRATIONS.mcpOAuthClientCredentials)).toBe("0060_mcp_oauth_client_credentials");
    expect(tagsByWhen.get(MAIN_MIGRATIONS.globalAdminRoleName)).toBe("0061_global_admin_role_name");
  });

  it("name alpha-2 migrations that exist in the alpha-2 journal fixture and nowhere in main's", () => {
    const alpha2Whens = new Set(readJournal(alpha2Folder).map((entry) => entry.when));
    const mainWhens = new Set(readJournal(mainFolder).map((entry) => entry.when));

    for (const when of Object.values(ALPHA_2_MIGRATIONS)) {
      expect(alpha2Whens.has(when)).toBe(true);
      expect(mainWhens.has(when)).toBe(false);
    }
  });

  it("record as applied only main migrations whose SQL is byte-identical to the alpha-2 one", () => {
    const alpha2Tags = new Map(readJournal(alpha2Folder).map((entry) => [entry.when, entry.tag]));
    const mainTags = new Map(readJournal(mainFolder).map((entry) => [entry.when, entry.tag]));
    const identicalPairs: Array<[number, number]> = [
      [MAIN_MIGRATIONS.sessionManualEstimate, ALPHA_2_MIGRATIONS.sessionManualEstimate],
      [MAIN_MIGRATIONS.welcomeTour, ALPHA_2_MIGRATIONS.welcomeTour],
      [MAIN_MIGRATIONS.unattendedAutomation, ALPHA_2_MIGRATIONS.unattendedAutomation],
      [MAIN_MIGRATIONS.seedUnattendedAutomation, ALPHA_2_MIGRATIONS.seedUnattendedAutomation],
      [MAIN_MIGRATIONS.entraAccountIdOid, ALPHA_2_MIGRATIONS.entraAccountIdOid],
      [MAIN_MIGRATIONS.globalAdminRoleName, ALPHA_2_MIGRATIONS.globalAdminRoleName],
    ];

    for (const [mainWhen, alpha2When] of identicalPairs) {
      const mainSql = readFileSync(join(mainFolder, `${mainTags.get(mainWhen)}.sql`), "utf8");
      const alpha2Sql = readFileSync(join(alpha2Folder, `${alpha2Tags.get(alpha2When)}.sql`), "utf8");
      expect(mainSql).toBe(alpha2Sql);
    }
  });
});
