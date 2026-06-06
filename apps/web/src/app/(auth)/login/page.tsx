"use client";

import Link from "next/link";
import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

const isDev = process.env.NODE_ENV === "development";

function LoginForm() {
  const searchParams = useSearchParams();
  const isExpired = searchParams.get("expired") === "true";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL: "/admin",
      });
      if (result.error) {
        setError(result.error.message ?? "Invalid email or password");
        return;
      }
      window.location.href = "/admin";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const onDevLogin = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        window.location.href = "/admin";
      } else {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Dev login failed");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          {isExpired && (
            <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Your session has expired, please sign in again.
            </p>
          )}
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
            {isDev && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={onDevLogin}
                disabled={submitting || !email}
              >
                Dev login (skip password)
              </Button>
            )}
            <p className="text-center text-sm text-muted-foreground">
              No account?{" "}
              <Link href="/register" className="underline">
                Register
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
