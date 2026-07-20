import {
  domainError,
  err,
  ok,
  type IOrganisationRepository,
  type Organisation,
  type Result,
} from "@rbrasier/domain";

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Normalises a user-entered email domain: lower-cased, trimmed, a leading "@"
// dropped. An empty value becomes null (unset).
export const normaliseEmailDomain = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const cleaned = value.trim().toLowerCase().replace(/^@+/, "");
  return cleaned.length > 0 ? cleaned : null;
};

export class CreateOrganisation {
  constructor(private readonly organisations: IOrganisationRepository) {}

  async execute(input: { name: string; emailDomain?: string | null }): Promise<Result<Organisation>> {
    const name = input.name.trim();
    if (name.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Organisation name is required."));
    }
    const slugResult = await this.freeSlug(slugify(name) || "organisation");
    if (slugResult.error) return slugResult;
    return this.organisations.create({
      name,
      slug: slugResult.data,
      emailDomain: normaliseEmailDomain(input.emailDomain),
    });
  }

  // Probes for the first unused slug, appending -2, -3, … on collision so two
  // organisations can share a display name without violating the unique slug.
  private async freeSlug(base: string): Promise<Result<string>> {
    let candidate = base;
    let suffix = 1;
    for (;;) {
      const existing = await this.organisations.findBySlug(candidate);
      if (existing.error) return existing;
      if (!existing.data) return ok(candidate);
      suffix += 1;
      candidate = `${base}-${suffix}`;
    }
  }
}
