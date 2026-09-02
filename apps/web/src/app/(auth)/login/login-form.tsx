"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { CERT_SIGN_IN_ERROR_PARAM, certSignInErrorMessage } from "@/lib/cert-sign-in-errors";
import { trpc } from "@/trpc/client";
import { ForgotPasswordModal } from "./forgot-password-modal";

const isDev = process.env.NODE_ENV === "development";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isExpired = searchParams.get("expired") === "true";
  // A failed certificate sign-in redirects back here with a code rather than
  // dead-ending on a JSON body the person who clicked cannot act on.
  const certError = certSignInErrorMessage(searchParams.get(CERT_SIGN_IN_ERROR_PARAM));

  // First-run: an install with no admin has nothing to sign in to yet, so route
  // the very first visitor to the bootstrap screen instead (ADR-041 §0).
  const adminExistsQuery = trpc.bootstrap.adminExists.useQuery();
  useEffect(() => {
    if (adminExistsQuery.data && !adminExistsQuery.data.adminExists) {
      router.replace("/setup");
    }
  }, [adminExistsQuery.data, router]);

  const methodsQuery = trpc.settings.enabledAuthMethods.useQuery();
  const emailPasswordEnabled = methodsQuery.data?.emailPassword ?? true;
  const entraEnabled = methodsQuery.data?.entra ?? false;
  // Defaults to off until the query resolves, so an install that does not offer
  // certificates never flashes a control the user cannot use.
  const pkiEnabled = methodsQuery.data?.pki ?? false;
  // Needs both password sign-in and a working mail transport, so it stays off
  // until the server says otherwise rather than offering a link that leads to a
  // mail that can never arrive.
  const passwordResetEnabled = methodsQuery.data?.passwordReset ?? false;

  // Middleware sends the path the visitor was denied; certificate sign-in hands
  // it back to the cert route so the deep link survives the trip through /login.
  const redirectTo = searchParams.get("redirect") ?? "/chats";
  const certificateHref = `/api/auth/cert?redirect=${encodeURIComponent(redirectTo)}`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);

  const onMicrosoftSignIn = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      await authClient.signIn.social({ provider: "microsoft", callbackURL: "/chats" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSubmitting(false);
    }
  };

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({
        email,
        password,
        callbackURL: "/chats",
      });
      if (result.error) {
        setError(result.error.message ?? "Invalid email or password");
        return;
      }
      window.location.href = "/chats";
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
        window.location.href = "/chats";
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
          {certError && (
            <p
              data-testid="login-certificate-error"
              className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-900"
            >
              {certError}
            </p>
          )}
          {emailPasswordEnabled && (
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
              {passwordResetEnabled && (
                <p className="text-center text-sm">
                  <button
                    type="button"
                    className="text-muted-foreground underline"
                    onClick={() => setShowForgotPassword(true)}
                  >
                    Forgot your password?
                  </button>
                </p>
              )}
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
          )}
          {entraEnabled && (
            <div className="space-y-4">
              {emailPasswordEnabled && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              {!emailPasswordEnabled && error && (
                <p className="text-sm text-destructive">{error}</p>
              )}
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={onMicrosoftSignIn}
                disabled={submitting}
              >
                Sign in with Microsoft
              </Button>
            </div>
          )}
          {pkiEnabled && (
            <div className="space-y-4">
              {(emailPasswordEnabled || entraEnabled) && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              {/* A plain navigation, not a fetch: the mTLS proxy attaches the
                  x-ssl-client-* headers to the browser's own request. */}
              <Button asChild type="button" variant="outline" className="w-full">
                <a href={certificateHref} data-testid="login-certificate">
                  Sign in with your certificate
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ForgotPasswordModal
        open={showForgotPassword}
        onClose={() => setShowForgotPassword(false)}
      />
    </div>
  );
}
