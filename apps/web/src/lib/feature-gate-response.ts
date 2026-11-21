import { NextResponse } from "next/server";
import type { ExperimentalFeatureFlag } from "@wayfinder/application";
import type { Container } from "@/lib/container";

// A route handler's reading of an experimental flag for the signed-in caller:
// null when the flag is on for them, otherwise the 403 to answer with. A failed
// lookup reads as off, matching a fresh install where these flags default off.
export const featureGateResponse = async (
  container: Container,
  principal: { userId: string; isAdmin: boolean },
  key: ExperimentalFeatureFlag,
): Promise<NextResponse | null> => {
  const result = await container.useCases.isFeatureEnabledForUser.execute(
    principal.userId,
    key,
    principal.isAdmin,
  );
  if (!result.error && result.data === true) return null;
  return NextResponse.json({ error: "This feature is switched off." }, { status: 403 });
};
