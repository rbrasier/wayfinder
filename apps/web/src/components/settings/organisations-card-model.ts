export type OrganisationsCardMode = "single-name" | "managed-elsewhere";

// `undefined` is the in-flight state of the `organisation.isEnabled` query.
// Treating it as disabled keeps the name field on screen while it resolves —
// the opposite default flashes an empty card on every visit to Configuration.
export function resolveOrganisationsCardMode(
  organisationsEnabled: boolean | undefined,
): OrganisationsCardMode {
  return organisationsEnabled === true ? "managed-elsewhere" : "single-name";
}
