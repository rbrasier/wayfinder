import { Suspense } from "react";
import { createServerHelpers } from "@/trpc/server";
import { LoginForm } from "./login-form";

/**
 * Server-renders the sign-in screen with its auth methods already resolved.
 *
 * The form used to ask for `enabledAuthMethods` from the browser, so the page
 * painted with the query's fallbacks — password on, everything else off — and
 * the Microsoft and certificate buttons appeared a moment later. Prefetching
 * here puts the answer in the hydration payload, so the first paint already has
 * the right set of buttons and nothing pops in.
 */
export default async function LoginPage() {
  const { trpc, HydrateClient } = await createServerHelpers();
  await Promise.all([
    trpc.settings.enabledAuthMethods.prefetch(),
    trpc.bootstrap.adminExists.prefetch(),
  ]);

  return (
    <HydrateClient>
      <Suspense>
        <LoginForm />
      </Suspense>
    </HydrateClient>
  );
}
