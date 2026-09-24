import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Figtree, JetBrains_Mono } from "next/font/google";
import { connection } from "next/server";
import { Toaster } from "sonner";
import { NavigationProgress } from "@/components/navigation-progress";
import { SiteBanner } from "@/components/site-banner";
import { buildBrandStyleSheet } from "@/lib/brand-style";
import { getContainer } from "@/lib/container";
import { TrpcProvider } from "@/trpc/Provider";
import "@/styles/globals.css";

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Wayfinder",
  description: "AI-guided workflow agent for document-heavy processes",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The brand is admin-configured at runtime (ADR-060), so the layout must render
  // per request rather than be prerendered with whatever was set at build time.
  await connection();
  const brandStyleSheet = buildBrandStyleSheet(
    await getContainer().runtimeConfig.getBrandingConfig(),
  );

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${figtree.variable} ${jetBrainsMono.variable}`}
    >
      {/* In the server-rendered head so the brand colour is in the first paint;
          a client fetch would flash Wayfinder blue on every page load. */}
      <head>{brandStyleSheet && <style id="wf-brand-palette">{brandStyleSheet}</style>}</head>
      {/* A flex column so the site banner subtracts from the viewport instead
          of adding to it — the route layouts below fill the remaining space
          rather than each claiming a full screen height. */}
      <body className="flex h-dvh flex-col bg-background font-sans antialiased">
        <NavigationProgress />
        <TrpcProvider>
          <SiteBanner />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </TrpcProvider>
        {/* `expand` keeps concurrent toasts as a spaced column growing upward
            from the corner. Sonner's default stacks them on top of one another
            and only fans them out on hover, which reads as one toast obscuring
            the rest. */}
        <Toaster richColors closeButton expand visibleToasts={5} />
      </body>
    </html>
  );
}
