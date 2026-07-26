import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Sans, DM_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { NavigationProgress } from "@/components/navigation-progress";
import { SiteBanner } from "@/components/site-banner";
import { TrpcProvider } from "@/trpc/Provider";
import "@/styles/globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["300", "400", "500", "600"],
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-dm-mono",
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Wayfinder",
  description: "AI-guided workflow agent for document-heavy processes",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${dmSans.variable} ${dmMono.variable}`}>
      {/* A flex column so the site banner subtracts from the viewport instead
          of adding to it — the route layouts below fill the remaining space
          rather than each claiming a full screen height. */}
      <body className="flex h-dvh flex-col bg-background font-sans antialiased">
        <NavigationProgress />
        <TrpcProvider>
          <SiteBanner />
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </TrpcProvider>
        <Toaster richColors closeButton />
      </body>
    </html>
  );
}
