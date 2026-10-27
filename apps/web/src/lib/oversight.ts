import type { Container } from "./container";

interface SignedInCaller {
  readonly userId: string;
  readonly isAdmin: boolean;
}

// The REST twin of tRPC's `canOversee` (ADR-066 §4): whether the caller may
// open and edit other people's chats and flows. A failed permission lookup
// denies, so an outage never widens access.
export const resolveCanOversee = async (container: Container, caller: SignedInCaller): Promise<boolean> => {
  if (caller.isAdmin) return true;
  const permissions = await container.resolveEffectivePermissions(caller.userId, false);
  if (permissions.error) return false;
  return permissions.data.has("admin:oversight");
};
