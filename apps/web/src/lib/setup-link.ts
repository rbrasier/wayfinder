import { randomBytes } from "node:crypto";
import { EnsureSetupToken } from "@wayfinder/application";
import {
  DrizzleAdminLookup,
  DrizzleSystemSettingsRepository,
  EncryptedSystemSettingsRepository,
  SettingsEncryptionService,
  createDatabase,
  createSettingsEncryptionKey,
} from "@wayfinder/adapters/bootstrap";
import { serverEnv } from "./env";

// Emits the first-run setup link (ADR-041 §5) while no administrator exists.
//
// Deliberately does not go through getContainer(), and imports the narrow
// `@wayfinder/adapters/bootstrap` entry rather than the package barrel. Either
// one would build the entire application graph — AI providers, the extraction
// engine, the embeddings model — on the boot path, delaying the dev server's
// first response and holding thousands of modules in memory from startup.
// Ensuring the token needs only a database handle and the settings repository.
export async function emitSetupLink(): Promise<void> {
  const env = serverEnv();
  // Pool of one: this runs a single query at boot and is separate from the
  // container's pool, so it must not claim a share of Postgres' connection cap.
  const db = createDatabase(env.DATABASE_URL, 1);
  const systemSettings = new EncryptedSystemSettingsRepository(
    new DrizzleSystemSettingsRepository(db),
    new SettingsEncryptionService(createSettingsEncryptionKey(env.SETTINGS_ENCRYPTION_KEY)),
  );
  const ensureSetupToken = new EnsureSetupToken(
    new DrizzleAdminLookup(db),
    systemSettings,
    {
      envSetupToken: env.SETUP_TOKEN ?? null,
      generateToken: () => randomBytes(24).toString("base64url"),
    },
  );

  const result = await ensureSetupToken.execute();
  if (result.error || !result.data) return;

  const link = `${env.BETTER_AUTH_URL}/setup?token=${result.data}`;
  console.log(
    `\n────────────────────────────────────────────────────────────\n` +
      `  Wayfinder first-run setup — create your admin account here:\n` +
      `  ${link}\n` +
      `────────────────────────────────────────────────────────────\n`,
  );
}
