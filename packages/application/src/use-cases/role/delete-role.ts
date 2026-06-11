import { domainError, err, type IRoleRepository, type Result } from "@rbrasier/domain";

export class DeleteRole {
  constructor(private readonly roles: IRoleRepository) {}

  async execute(roleId: string): Promise<Result<void>> {
    const role = await this.roles.findById(roleId);
    if (role.error) return role;
    if (!role.data) return err(domainError("NOT_FOUND", "Role not found."));
    if (role.data.isSystem || role.data.isImmutable || role.data.isDefault) {
      return err(domainError("FORBIDDEN", "System roles cannot be deleted."));
    }

    // FK cascades remove the role's permission grants, user assignments and
    // feature-flag scoping rows.
    return this.roles.delete(roleId);
  }
}
