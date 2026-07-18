export interface Group {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewGroup {
  readonly name: string;
  readonly description?: string | null;
}

export interface GroupUpdate {
  readonly name?: string;
  readonly description?: string | null;
}
