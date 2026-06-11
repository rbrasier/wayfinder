import {
  domainError,
  err,
  SYSTEM_ROLE_KEYS,
  type IRoleRepository,
  type Result,
  type Role,
} from "@rbrasier/domain";

const RESERVED_KEYS = new Set<string>(Object.values(SYSTEM_ROLE_KEYS));

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export class CreateRole {
  constructor(private readonly roles: IRoleRepository) {}

  async execute(input: { name: string; description?: string | null }): Promise<Result<Role>> {
    const name = input.name.trim();
    if (name.length === 0) return err(domainError("VALIDATION_FAILED", "Role name is required."));

    const base = slugify(name);
    if (base.length === 0) {
      return err(domainError("VALIDATION_FAILED", "Role name must contain letters or numbers."));
    }

    const uniqueKey = await this.resolveUniqueKey(base);
    if (uniqueKey.error) return uniqueKey;

    return this.roles.create({
      key: uniqueKey.data,
      name,
      description: input.description?.trim() || null,
      isSystem: false,
      isImmutable: false,
      isDefault: false,
    });
  }

  private async resolveUniqueKey(base: string): Promise<Result<string>> {
    let candidate = base;
    let suffix = 1;
    // Bounded probe to avoid an unbounded loop if findByKey keeps failing.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (RESERVED_KEYS.has(candidate)) {
        candidate = `${base}_${++suffix}`;
        continue;
      }
      const existing = await this.roles.findByKey(candidate);
      if (existing.error) return existing;
      if (!existing.data) return { data: candidate };
      candidate = `${base}_${++suffix}`;
    }
    return err(domainError("VALIDATION_FAILED", "Could not derive a unique role key."));
  }
}
