"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/trpc/client";

function SetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenFromQuery = searchParams.get("token") ?? "";

  const adminExistsQuery = trpc.bootstrap.adminExists.useQuery();
  const createAdmin = trpc.bootstrap.createAdmin.useMutation();

  const [token, setToken] = useState(tokenFromQuery);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Keep the token field in sync if the query param resolves after mount.
  useEffect(() => {
    if (tokenFromQuery) setToken(tokenFromQuery);
  }, [tokenFromQuery]);

  // The bootstrap screen self-disables: once an admin exists it is no longer a
  // setup surface, so send the visitor to sign in.
  useEffect(() => {
    if (adminExistsQuery.data?.adminExists) router.replace("/login");
  }, [adminExistsQuery.data?.adminExists, router]);

  const onSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      await createAdmin.mutateAsync({ email, password, token });
      // Establish the session for the freshly-created admin, then land in the
      // admin area where the setup wizard opens.
      const signIn = await authClient.signIn.email({ email, password });
      if (signIn.error) {
        setError(signIn.error.message ?? "Account created, but automatic sign-in failed.");
        return;
      }
      window.location.href = "/admin";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  if (adminExistsQuery.isLoading || adminExistsQuery.data?.adminExists) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Welcome to Wayfinder</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Create the administrator account for this installation. This one-time
          screen disappears once an admin exists.
        </p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token">Setup token</Label>
            <Input
              id="token"
              type="text"
              required
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Printed in the server startup logs"
            />
            <p className="text-xs text-muted-foreground">
              Find this in the server logs, on the line linking to this page.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Admin email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Creating admin…" : "Create admin account"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function SetupPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f6f3] p-4">
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <SetupForm />
      </Suspense>
    </main>
  );
}
