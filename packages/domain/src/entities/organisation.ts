// An organisation is an internal sharing/visibility scope (ADR-038), one rung
// coarser than an ADR-036 group. It carries no data-isolation semantics: it only
// governs which users can discover a flow published to `{ kind: "organisation" }`.
export interface Organisation {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  // Optional email domain (e.g. "acme.com"). Descriptive metadata an admin can
  // edit; null when unset.
  readonly emailDomain: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NewOrganisation {
  readonly name: string;
  readonly slug: string;
  readonly emailDomain?: string | null;
}

export interface OrganisationUpdate {
  readonly name?: string;
  readonly slug?: string;
  readonly emailDomain?: string | null;
}

// System-setting key + default for the organisations feature switch (ADR-038).
// Organisations are OFF by default: a single global organisation name is used in
// AI prompts, and no membership resolution runs on sign-in.
export const ORGANISATIONS_ENABLED_SETTING_KEY = "organisations_enabled";

export const parseOrganisationsEnabled = (raw: string | null | undefined): boolean =>
  raw === "true";
