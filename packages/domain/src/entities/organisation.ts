// An organisation is an internal sharing/visibility scope (ADR-038), one rung
// coarser than an ADR-036 group. It carries no data-isolation semantics: it only
// governs which users can discover a flow published to `{ kind: "organisation" }`.
export interface Organisation {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewOrganisation {
  readonly name: string;
  readonly slug: string;
}

export interface OrganisationUpdate {
  readonly name?: string;
  readonly slug?: string;
}
