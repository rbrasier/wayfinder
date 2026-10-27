import {
  domainError,
  err,
  isAdminRoleKey,
  ok,
  type IUserRoleRepository,
  type Result,
  type User,
} from "@rbrasier/domain";
import type { AdminCaller } from "./admin-caller";

// A delegated User Admin must not change an account that holds admin access
// (ADR-066 §3): resetting a Global Admin's password, or editing a Technical
// Admin's email, would let them sign in as that person and inherit their access.
export const refuseAdminAccountForDelegate = async (
  target: User,
  userRoles: IUserRoleRepository,
  caller: AdminCaller,
): Promise<Result<void>> => {
  if (caller.isAdmin) return ok(undefined);
  // Your own account is not a step up in access, so a Technical Admin can still
  // edit their own profile; promoting yourself is caught by the grant check.
  if (caller.userId === target.id) return ok(undefined);
  if (target.isAdmin) return err(adminAccountRefusal());

  const roles = await userRoles.listRolesForUser(target.id);
  if (roles.error) return roles;
  if (roles.data.some((role) => isAdminRoleKey(role.key))) return err(adminAccountRefusal());
  return ok(undefined);
};

export const refuseAdminGrantForDelegate = (
  isAdminRequested: boolean | undefined,
  caller: AdminCaller,
): Result<void> => {
  if (caller.isAdmin || isAdminRequested !== true) return ok(undefined);
  return err(domainError("FORBIDDEN", "Only a Global Admin can make someone a Global Admin."));
};

const adminAccountRefusal = () =>
  domainError("FORBIDDEN", "Only a Global Admin can change an account that holds admin access.");
