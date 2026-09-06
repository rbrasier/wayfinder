/**
 * The canonical form of an email address used as the account key.
 *
 * One address must resolve to one account whatever the sign-in method, so every
 * lookup and every write has to agree on spelling. Better Auth already
 * lowercases on its own paths; certificate subject names and hand-typed admin
 * addresses do not, and `core_users.email` is a case-sensitive unique column.
 */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase();

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: string | null;
  readonly team: string | null;
  // The organisation the user belongs to (ADR-038). Null means unaffiliated,
  // which behaves identically to the pre-organisation app.
  readonly organisationId: string | null;
  // Whether the user's email is verified. Gates email-domain organisation
  // resolution (ADR-038 §4) — an unverified address is never trusted to place a
  // user, since domains are spoofable at an unverified signup.
  readonly emailVerified: boolean;
  readonly isAdmin: boolean;
  // When the first-login welcome tour was completed or skipped (ADR-056). Null
  // means it is still pending and the `(user)` layout shows it on the next page.
  readonly welcomeTourCompletedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewUser {
  readonly email: string;
  readonly name?: string | null;
  readonly role?: string | null;
  readonly team?: string | null;
  readonly organisationId?: string | null;
  readonly isAdmin?: boolean;
}

export interface UserUpdate {
  readonly email?: string;
  readonly name?: string | null;
  readonly role?: string | null;
  readonly team?: string | null;
  readonly organisationId?: string | null;
  readonly isAdmin?: boolean;
  readonly welcomeTourCompletedAt?: Date | null;
}
