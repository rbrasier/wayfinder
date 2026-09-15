import type { Result } from "../result";

export interface PasswordResetRequest {
  readonly userId: string;
  readonly password: string;
}

export interface PasswordResetOutcome {
  readonly userId: string;
  // How many sign-ins the reset ended. Surfaced so the administrator is told
  // what the reset actually did to the account, rather than being left to guess
  // whether the user is still signed in somewhere.
  readonly sessionsRevoked: number;
}

/**
 * Administrator-initiated replacement of one user's local password.
 *
 * Distinct from `IAdminRecovery` on purpose. Recovery is break-glass: it runs
 * from a shell, and it re-enables email/password sign-in across the deployment
 * because the administrator running it is locked out of the settings page that
 * otherwise would. This port is the everyday counterpart — reached from the
 * admin UI by someone who is already signed in — so it must never change the
 * deployment's auth config as a side effect.
 *
 * Implemented in adapters over the auth provider: the hash has to be in exactly
 * the format that provider's sign-in verifies, so the provider's own hasher is
 * the only correct source of it.
 *
 * Deliberately cannot grant administrator rights, for the same reason
 * `IAdminRecovery` cannot: a port that reset a password *and* set `isAdmin`
 * would be an escalation tool.
 */
export interface IPasswordResetter {
  resetPassword(input: PasswordResetRequest): Promise<Result<PasswordResetOutcome>>;
}

// The floor the reset use case enforces. Matches the minimum the self-service
// change-password form applies, so an administrator cannot set a password the
// user would be forbidden from choosing themselves.
export const MINIMUM_PASSWORD_LENGTH = 8;
