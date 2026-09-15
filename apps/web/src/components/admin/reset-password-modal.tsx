"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { MINIMUM_PASSWORD_LENGTH, validatePasswordPair } from "@/components/password-form-model";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/trpc/client";

interface ResetPasswordTarget {
  id: string;
  email: string;
}

interface ResetPasswordModalProps {
  // Null closes the modal, so the caller never has to keep an `open` flag and a
  // target in step with each other.
  target: ResetPasswordTarget | null;
  onClose: () => void;
}

export function ResetPasswordModal({ target, onClose }: ResetPasswordModalProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleClose = () => {
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    onClose();
  };

  const resetMutation = trpc.user.resetPassword.useMutation({
    onSuccess: (result) => {
      toast.success(
        result.sessionsRevoked > 0
          ? `Password reset — ${target?.email} has been signed out of all sessions.`
          : `Password reset for ${target?.email}.`,
      );
      handleClose();
    },
    onError: (mutationError) => setError(mutationError.message),
  });

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    setError(null);
    if (!target) return;

    const invalid = validatePasswordPair(newPassword, confirmPassword);
    if (invalid) {
      setError(invalid);
      return;
    }

    resetMutation.mutate({ id: target.id, password: newPassword });
  };

  return (
    <Dialog open={target !== null} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogCloseButton />
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogBody className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Set a new password for <strong>{target?.email}</strong>. They will be signed out
              of every session and will need the new password to sign in again.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="reset-new-password">New password</Label>
              <Input
                id="reset-new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MINIMUM_PASSWORD_LENGTH}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                disabled={resetMutation.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="reset-confirm-password">Confirm new password</Label>
              <Input
                id="reset-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={MINIMUM_PASSWORD_LENGTH}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                disabled={resetMutation.isPending}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={resetMutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={resetMutation.isPending}>
              {resetMutation.isPending ? "Resetting…" : "Reset password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
