import type { IUserRepository } from "@rbrasier/domain";

/**
 * Promotes the user matching ADMIN_SEED_EMAIL to admin if they exist
 * and are not already admin. No-ops if the env var is unset or user
 * has not signed up yet — call again after first login.
 */
export const seedAdmin = async (
  users: IUserRepository,
  adminSeedEmail: string | undefined,
): Promise<void> => {
  if (!adminSeedEmail) return;
  const found = await users.findByEmail(adminSeedEmail);
  if (found.error || !found.data) return;
  if (found.data.isAdmin) return;
  await users.update(found.data.id, { isAdmin: true });
};
