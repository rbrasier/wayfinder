import type { PermissionKey } from "../entities/permission";
import type { NewRole, Role } from "../entities/role";
import type { Result } from "../result";

export interface IRoleRepository {
  list(): Promise<Result<Role[]>>;
  findByKey(key: string): Promise<Result<Role | null>>;
  findById(id: string): Promise<Result<Role | null>>;
  create(role: NewRole): Promise<Result<Role>>;
  listPermissions(roleId: string): Promise<Result<PermissionKey[]>>;
  replacePermissions(roleId: string, keys: PermissionKey[]): Promise<Result<void>>;
}

export interface UserRoleAssignment {
  readonly userId: string;
  readonly roleId: string;
}

export interface IUserRoleRepository {
  listRolesForUser(userId: string): Promise<Result<Role[]>>;
  listUsersForRole(roleId: string): Promise<Result<string[]>>;
  assign(userId: string, roleId: string): Promise<Result<void>>;
  remove(userId: string, roleId: string): Promise<Result<void>>;
}
