import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { TrpcProvider } from "@/trpc/Provider";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Wayfinder",
  description: "AI-guided workflow agent for document-heavy processes",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        <TrpcProvider>{children}</TrpcProvider>
        <Toaster richColors closeButton />
      </body>
    </html>
  );
}
