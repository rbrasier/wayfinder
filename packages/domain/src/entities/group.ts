export interface Group {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  // Owning organisation (ADR-038) when organisations are enabled; null means the
  // group is global.
  readonly organisationId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewGroup {
  readonly name: string;
  readonly description?: string | null;
  readonly organisationId?: string | null;
}

export interface GroupUpdate {
  readonly name?: string;
  readonly description?: string | null;
  readonly organisationId?: string | null;
}
