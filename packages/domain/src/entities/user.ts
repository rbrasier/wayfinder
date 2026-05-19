export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly isAdmin: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewUser {
  readonly email: string;
  readonly name?: string | null;
  readonly isAdmin?: boolean;
}

export interface UserUpdate {
  readonly email?: string;
  readonly name?: string | null;
  readonly isAdmin?: boolean;
}
