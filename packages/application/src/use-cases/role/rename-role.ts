import { domainError, err, type IRoleRepository, type Result, type Role } from "@rbrasier/domain";

export class RenameRole {
  constructor(private readonly roles: IRoleRepository) {}

  async execute(input: {
    roleId: string;
    name: string;
    description?: string | null;
  }): Promise<Result<Role>> {
    const name = input.name.trim();
    if (name.length === 0) return err(domainError("VALIDATION_FAILED", "Role name is required."));

    const role = await this.roles.findById(input.roleId);
    if (role.error) return role;
    if (!role.data) return err(domainError("NOT_FOUND", "Role not found."));
    if (role.data.isImmutable) {
      return err(domainError("FORBIDDEN", "This role cannot be renamed."));
    }

    return this.roles.update(input.roleId, {
      name,
      description: input.description === undefined ? undefined : input.description?.trim() || null,
    });
  }
}
