import type { ReactNode } from "react";
import { BrandName, BrandTile } from "@/components/branding/brand-mark";
import { brandMarkView } from "@/components/branding/brand-mark-model";
import { getContainer } from "@/lib/container";
import { toPublicBranding } from "@/lib/public-branding";

// The brand sits above the card so an unauthenticated screen — the first thing
// a new user ever sees — is identifiably this install without the app shell.
// Read straight from the container: these pages have no signed-in session and
// the mark must be in the server-rendered HTML.
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const branding = await getContainer().runtimeConfig.getBrandingConfig();
  const brandView = brandMarkView(toPublicBranding(branding));

  return (
    <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[22px] overflow-auto bg-[#faf9f7] p-4">
      <div className="flex items-center gap-[10px]">
        <BrandTile view={brandView} size="auth" />
        <BrandName view={brandView} size="auth" />
        <span className="rounded-[4px] border border-[#dedad2] px-[5px] py-[2px] font-mono text-[9px] uppercase tracking-[0.1em] text-[#736d5f]">
          Alpha
        </span>
      </div>
      {children}
    </main>
  );
}
