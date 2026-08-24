import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { core_accounts, core_sessions } from "../db/schema/core";
import type { SessionRevocationRegistry } from "./session-revocation";

export const ENTRA_PROVIDER_ID = "microsoft";
export const CREDENTIAL_PROVIDER_ID = "credential";

export interface LinkedAccount {
  readonly userId: string;
  readonly providerId: string;
}

/**
 * Entra takes precedence over a password: once a Microsoft identity is attached
 * to an account, that account is Entra-only.
 *
 * This is also what makes `accountLinking.requireLocalEmailVerified: false`
 * safe. That gate exists so an attacker who pre-registers a password account at
 * a victim's address cannot have the victim's Entra identity linked into the
 * attacker-owned row. Wayfinder never verifies email addresses locally, so the
 * gate would reject every legitimate link; removing the password and revoking
 * live sessions in the same flow strips the attacker of everything the gate was
 * protecting instead.
 *
 * Must be driven from Better Auth's `account.create.before` hook. Better Auth
 * wraps each request in `runWithAdapter`, which defers `create.after` hooks to
 * the end of the request — by then the post-link session exists and revoking
 * every session for the user destroys the sign-in that triggered the link.
 * `create.before` is awaited inline, so the revocation lands strictly before
 * the new session is issued.
 *
 * A throw propagates out of Better Auth's `linkAccount` and fails the sign-in,
 * which is the safe direction: no link is recorded while a usable password
 * survives.
 */
export const applyEntraPrecedence = async (
  database: Database,
  account: LinkedAccount,
  sessionRevocations?: SessionRevocationRegistry,
): Promise<void> => {
  if (account.providerId !== ENTRA_PROVIDER_ID) return;

  await database
    .delete(core_accounts)
    .where(
      and(
        eq(core_accounts.user_id, account.userId),
        eq(core_accounts.provider_id, CREDENTIAL_PROVIDER_ID),
      ),
    );

  await database.delete(core_sessions).where(eq(core_sessions.user_id, account.userId));
  // Deleting the rows is only half of a revocation: a principal cached under the
  // old password session would otherwise keep resolving until the TTL lapsed
  // (ADR-035 §1).
  sessionRevocations?.revoke(account.userId);
};
