"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { MINIMUM_PASSWORD_LENGTH, validatePasswordPair } from "@/components/password-form-model";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PASSWORD_RESET_ERROR_PARAM, PASSWORD_RESET_TOKEN_PARAM } from "@/lib/password-reset";

export function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get(PASSWORD_RESET_TOKEN_PARAM);
  // Better Auth checks the token before redirecting here, so a link that has
  // expired or been used already arrives flagged rather than failing on submit.
  const linkRejected = searchParams.get(PASSWORD_RESET_ERROR_PARAM) !== null || !token;

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (!token) return;

    const invalid = validatePasswordPair(newPassword, confirmPassword);
    if (invalid) {
      setError(invalid);
      return;
    }

    setSubmitting(true);
    try {
      const result = await authClient.resetPassword({ newPassword, token });
      if (result.error) {
        setError(result.error.message ?? "Could not reset your password. Request a new link.");
        return;
      }
      setDone(true);
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
          <CardTitle>Choose a new password</CardTitle>
        </CardHeader>
        <CardContent>
          {linkRejected && (
            <div className="space-y-4" data-testid="reset-password-invalid">
              <p className="text-sm text-destructive">
                This reset link is no longer valid. Links expire an hour after they are sent and
                can only be used once.
              </p>
              <Button asChild className="w-full">
                <Link href="/login">Back to sign in</Link>
              </Button>
            </div>
          )}

          {!linkRejected && done && (
            <div className="space-y-4" data-testid="reset-password-done">
              <p className="text-sm text-muted-foreground">
                Your password has been changed and you have been signed out everywhere else.
              </p>
              <Button asChild className="w-full">
                <Link href="/login">Sign in</Link>
              </Button>
            </div>
          )}

          {!linkRejected && !done && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-new-password">New password</Label>
                <Input
                  id="reset-new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MINIMUM_PASSWORD_LENGTH}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-confirm-password">Confirm new password</Label>
                <Input
                  id="reset-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MINIMUM_PASSWORD_LENGTH}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={submitting}
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Saving…" : "Set new password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
