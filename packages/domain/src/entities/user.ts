export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: string | null;
  readonly team: string | null;
  // The organisation the user belongs to (ADR-038). Null means unaffiliated,
  // which behaves identically to the pre-organisation app.
  readonly organisationId: string | null;
  readonly isAdmin: boolean;
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
}
