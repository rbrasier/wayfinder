import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-8 py-24">
      <div className="space-y-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          This app is ready to be built out.
        </h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          A hexagonal-architecture monorepo template with Next.js, tRPC, Drizzle, and a
          provider-agnostic AI layer. Replace this hero with your real product.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg">
          <Link href="/sample">Try the AI demo</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/settings">Settings</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/admin">Admin</Link>
        </Button>
      </div>
    </main>
  );
}
