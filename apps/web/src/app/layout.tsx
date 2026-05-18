import type { Metadata } from "next";
import type { ReactNode } from "react";
import { TrpcProvider } from "@/trpc/Provider";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "template",
  description: "AI app template — hexagonal architecture",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <TrpcProvider>{children}</TrpcProvider>
      </body>
    </html>
  );
}
