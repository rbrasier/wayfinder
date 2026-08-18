/**
 * Break-glass recovery of password sign-in for a locked-out administrator.
 *
 * Entra takes precedence over a password: linking a Microsoft identity destroys
 * the account's credential row. Once every administrator has signed in through
 * Entra, an outage at the identity provider locks the whole deployment out —
 * including out of the settings page that could turn email/password back on.
 * This command is the way back in, and it deliberately requires shell and
 * database access to the deployment rather than anything reachable over the
 * network.
 *
 * Usage:
 *   pnpm --filter @wayfinder/api recover-admin -- --email admin@example.com
 *   (the password is read from stdin, or from --password)
 *
 * See docs/guides/recovering-admin-access.md.
 */

import "dotenv/config";
import {
  BetterAuthAdminRecovery,
  createSessionRevocationRegistry,
  DrizzleAuditLogger,
  DrizzleSystemSettingsRepository,
  DrizzleUserRepository,
  EncryptedSystemSettingsRepository,
  HttpSiemForwarder,
  PinoLogger,
  SettingsEncryptionService,
  createAuth,
  createDatabase,
  createSettingsEncryptionKey,
} from "@rbrasier/adapters";
import {
  DEFAULT_SIEM_CONFIG,
  SIEM_CONFIG_SETTING_KEY,
  createDefaultAuthConfig,
  parseSiemConfig,
  type SiemConfig,
} from "@rbrasier/domain";
import { loadEnv } from "../env.js";

interface Arguments {
  readonly email: string;
  readonly password: string | null;
}

const parseArguments = (argv: readonly string[]): Arguments | null => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag || !flag.startsWith("--")) continue;
    const inlineSeparator = flag.indexOf("=");
    if (inlineSeparator !== -1) {
      values.set(flag.slice(2, inlineSeparator), flag.slice(inlineSeparator + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) continue;
    values.set(flag.slice(2), next);
    index += 1;
  }

  const email = values.get("email");
  if (!email) return null;
  return { email, password: values.get("password") ?? null };
};

// Piping the password keeps it out of the shell history and the process list,
// which is where `--password` on an interactive shell would leave it.
const readPasswordFromStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
};

const usage = [
  "Usage: pnpm --filter @wayfinder/api recover-admin -- --email <address> [--password <password>]",
  "",
  "Restores email/password sign-in for one existing account and re-enables the",
  "email/password method if an administrator had switched it off.",
  "",
  "With no --password, the password is read from stdin:",
  '  printf %s "$NEW_PASSWORD" | pnpm --filter @wayfinder/api recover-admin -- --email admin@example.com',
].join("\n");

const main = async (): Promise<number> => {
  const parsed = parseArguments(process.argv.slice(2));
  if (!parsed) {
    console.error(usage);
    return 2;
  }

  const password = parsed.password ?? (await readPasswordFromStdin());
  if (password.length === 0) {
    console.error("No password supplied on --password or stdin.");
    return 2;
  }

  const env = loadEnv();
  const database = createDatabase(env.DATABASE_URL, env.DATABASE_POOL_MAX);
  const logger = new PinoLogger(env.NODE_ENV !== "production");

  try {
    const settings = new EncryptedSystemSettingsRepository(
      new DrizzleSystemSettingsRepository(database),
      new SettingsEncryptionService(createSettingsEncryptionKey(env.SETTINGS_ENCRYPTION_KEY)),
    );

    // A break-glass credential reset is exactly the event a SIEM-integrated
    // deployment wants forwarded, so the audit logger gets the real forwarder
    // rather than a stub.
    const readSiemConfig = async (): Promise<SiemConfig> => {
      const stored = await settings.get(SIEM_CONFIG_SETTING_KEY);
      if (stored.error || !stored.data?.value) return DEFAULT_SIEM_CONFIG;
      return parseSiemConfig(stored.data.value);
    };

    const recovery = new BetterAuthAdminRecovery({
      database,
      users: new DrizzleUserRepository(database),
      settings,
      auditLogger: new DrizzleAuditLogger(
        database,
        new HttpSiemForwarder(readSiemConfig, logger),
        logger,
      ),
      // Only the password hasher is used, and scrypt takes no pepper — the
      // secret and base URL never reach the hash. They are still read from the
      // environment so this instance matches the running app's construction.
      getAuth: async () =>
        createAuth(database, {
          secret: process.env.BETTER_AUTH_SECRET ?? "admin-recovery-cli",
          baseURL: process.env.BETTER_AUTH_URL ?? env.WEB_BASE_URL,
          adminSeedEmail: undefined,
          authMethod: { type: "email-password" },
          // The defaults already say "email + password on, nothing else", which
          // is all this instance needs; taking them from the domain means a
          // future field on AuthConfig cannot silently break recovery.
          authConfig: createDefaultAuthConfig(),
          // Its own registry, and deliberately so: this is a separate CLI
          // process, so it shares no session cache with the running app. The
          // app's own cache TTL is what bounds the recovery's effect there.
          sessionRevocations: createSessionRevocationRegistry(),
        }),
    });

    const result = await recovery.recoverAdminAccess({ email: parsed.email, password });
    if (result.error) {
      console.error(`Recovery failed (${result.error.code}): ${result.error.message}`);
      return 1;
    }

    console.log(`Password sign-in restored for ${result.data.email}.`);
    if (!result.data.wasAdmin) {
      console.warn(
        "Warning: that account is not an administrator. This command never grants " +
          "administrator rights — re-run it against an administrator's address.",
      );
    }
    if (result.data.emailPasswordReEnabled) {
      console.log("Email/password sign-in was disabled and has been re-enabled.");
    }
    console.log(
      "Restart the application before signing in: the auth config is cached in-process " +
        "for the lifetime of each running instance.",
    );
    return 0;
  } finally {
    await database.$client.end();
  }
};

main()
  .then((code) => process.exit(code))
  .catch((cause) => {
    console.error(cause);
    process.exit(1);
  });
