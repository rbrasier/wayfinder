import Link from "next/link";
import type { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="container flex h-14 items-center gap-6">
          <Link href="/admin" className="font-semibold">
            Admin
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link href="/admin/users" className="text-muted-foreground hover:text-foreground">
              Users
            </Link>
            <Link href="/admin/errors" className="text-muted-foreground hover:text-foreground">
              Errors
            </Link>
            <Link href="/admin/flags" className="text-muted-foreground hover:text-foreground">
              Flags
            </Link>
            <Link href="/admin/usage" className="text-muted-foreground hover:text-foreground">
              Usage
            </Link>
            <Link href="/admin/settings" className="text-muted-foreground hover:text-foreground">
              Settings
            </Link>
          </nav>
          <div className="ml-auto">
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
              ← Back to app
            </Link>
          </div>
        </div>
      </header>
      <div className="container py-8">{children}</div>
    </div>
  );
}
