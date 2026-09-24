"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LOGIN_NOTICE_TEXT_MAX_LENGTH, type LoginNoticeMode } from "@rbrasier/domain";
import { loginNoticeSaveHint } from "@/components/login-notice/login-notice-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";

const MODE_LABELS: Record<LoginNoticeMode, string> = {
  off: "Off — no notice",
  once: "Once — until the wording changes",
  every_sign_in: "Every sign-in",
};

const MODE_ORDER: LoginNoticeMode[] = ["off", "once", "every_sign_in"];

// Admin → Settings → Sign-in notice (ADR-060 §5). Off by default.
export function LoginNoticeCard() {
  const utils = trpc.useUtils();
  const query = trpc.settings.getLoginNotice.useQuery();

  const [mode, setMode] = useState<LoginNoticeMode>("off");
  const [text, setText] = useState("");

  useEffect(() => {
    if (!query.data) return;
    setMode(query.data.mode);
    setText(query.data.text);
  }, [query.data]);

  const mutation = trpc.settings.setLoginNotice.useMutation({
    onSuccess: async () => {
      toast.success("Sign-in notice saved");
      await Promise.all([
        utils.settings.getLoginNotice.invalidate(),
        utils.settings.getLoginNoticeStatus.invalidate(),
      ]);
    },
    onError: (error) => toast.error(error.message ?? "Failed to save the sign-in notice"),
  });

  const hint = loginNoticeSaveHint(query.data, { mode, text });
  const blocked = mode !== "off" && text.trim().length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sign-in notice</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          A message everyone must acknowledge after signing in before they can use Wayfinder. Each
          acknowledgement is recorded in the audit log.
        </p>

        <div className="space-y-1">
          <Label htmlFor="login-notice-mode">When to show it</Label>
          <select
            id="login-notice-mode"
            data-testid="login-notice-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as LoginNoticeMode)}
            className="h-9 w-full rounded-[8px] border border-[#e7e3db] bg-white px-2 text-[13px]"
          >
            {MODE_ORDER.map((option) => (
              <option key={option} value={option}>
                {MODE_LABELS[option]}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="login-notice-text">Notice</Label>
          <Textarea
            id="login-notice-text"
            data-testid="login-notice-text"
            value={text}
            maxLength={LOGIN_NOTICE_TEXT_MAX_LENGTH}
            onChange={(event) => setText(event.target.value)}
            placeholder="This system is for authorised use only…"
          />
          {hint && (
            <p className={`text-xs ${blocked ? "text-destructive" : "text-muted-foreground"}`}>
              {hint}
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            data-testid="login-notice-save"
            onClick={() => mutation.mutate({ mode, text })}
            disabled={mutation.isPending || query.isLoading || blocked}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
