import type { PromptUserProfile } from "@rbrasier/domain";
import type { getContainer } from "@/lib/container";

type Container = ReturnType<typeof getContainer>;

// The prompt context a step's opening message needs when no chat request is
// there to supply it — a scheduled fire, or an unattended run handing a step to
// a person. The stream route reads the same values from the admin-settings cache.

export const resolveOrganisationName = async (container: Container): Promise<string | null> => {
  const setting = await container.repos.systemSettings.get("organisation_name");
  return setting.error ? null : (setting.data?.value ?? null);
};

export const resolveGlobalInstructions = async (container: Container): Promise<string | null> => {
  const setting = await container.repos.systemSettings.get("global_prompt");
  return setting.error ? null : (setting.data?.value ?? null);
};

export const resolveUserProfile = async (
  container: Container,
  userId: string,
): Promise<PromptUserProfile | null> => {
  const user = await container.repos.users.findById(userId);
  if (user.error || !user.data) return null;
  return { name: user.data.name, role: user.data.role, team: user.data.team };
};

export const resolveUserRole = async (container: Container, userId: string): Promise<"admin" | "user"> => {
  const user = await container.repos.users.findById(userId);
  if (user.error || !user.data) return "user";
  return user.data.role === "admin" ? "admin" : "user";
};

export const resolveIsAdmin = async (container: Container, userId: string): Promise<boolean> => {
  const user = await container.repos.users.findById(userId);
  return !user.error && (user.data?.isAdmin ?? false);
};
