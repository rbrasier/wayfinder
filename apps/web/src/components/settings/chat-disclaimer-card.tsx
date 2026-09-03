"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  createDefaultChatDisclaimerConfig,
  type ChatDisclaimerModalMode,
} from "@rbrasier/domain";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/trpc/client";

const MODAL_MODE_LABELS: Record<ChatDisclaimerModalMode, string> = {
  off: "Off — never show the modal",
  once: "Once only — the first chat a user opens",
  every_session: "Every new chat",
};

const MODAL_MODE_ORDER: ChatDisclaimerModalMode[] = ["off", "once", "every_session"];

export function ChatDisclaimerCard() {
  const utils = trpc.useUtils();
  const query = trpc.settings.getChatDisclaimer.useQuery();

  const [composerText, setComposerText] = useState("");
  const [modalMode, setModalMode] = useState<ChatDisclaimerModalMode>("off");
  const [modalText, setModalText] = useState("");

  useEffect(() => {
    if (!query.data) return;
    setComposerText(query.data.composerText);
    setModalMode(query.data.modalMode);
    setModalText(query.data.modalText);
  }, [query.data]);

  const mutation = trpc.settings.setChatDisclaimer.useMutation({
    onSuccess: async () => {
      toast.success("Chat disclaimers saved");
      await utils.settings.getChatDisclaimer.invalidate();
    },
    onError: (error) => toast.error(error.message ?? "Failed to save chat disclaimers"),
  });

  const handleSave = () => mutation.mutate({ composerText, modalMode, modalText });

  const handleRestoreDefaults = () => {
    const defaults = createDefaultChatDisclaimerConfig();
    setComposerText(defaults.composerText);
    setModalText(defaults.modalText);
  };

  const modalTextIsBlank = modalText.trim().length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Chat disclaimers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          The AI-verification wording users see in a chat. Both are plain text.
        </p>

        <div className="space-y-1">
          <Label htmlFor="chat-disclaimer-composer">Under the chat bar</Label>
          <Textarea
            id="chat-disclaimer-composer"
            data-testid="chat-disclaimer-composer"
            value={composerText}
            maxLength={300}
            onChange={(event) => setComposerText(event.target.value)}
            placeholder="Leave blank to show no disclaimer under the chat bar"
          />
          <p className="text-xs text-muted-foreground">
            {composerText.trim().length === 0
              ? "Blank — no line will appear under the chat bar."
              : "Shown beneath the message box on every chat."}
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="chat-disclaimer-mode">Disclaimer modal when a chat is opened</Label>
          <select
            id="chat-disclaimer-mode"
            data-testid="chat-disclaimer-mode"
            value={modalMode}
            onChange={(event) => setModalMode(event.target.value as ChatDisclaimerModalMode)}
            className="h-9 w-full rounded-[8px] border border-[#e7e3db] bg-white px-2 text-[13px]"
          >
            {MODAL_MODE_ORDER.map((mode) => (
              <option key={mode} value={mode}>
                {MODAL_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            A user&rsquo;s acknowledgement is remembered in their browser, so a different device or
            a cleared browser shows the modal again.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="chat-disclaimer-modal-text">Modal message</Label>
          <Textarea
            id="chat-disclaimer-modal-text"
            data-testid="chat-disclaimer-modal-text"
            value={modalText}
            maxLength={1000}
            onChange={(event) => setModalText(event.target.value)}
            placeholder="Wayfinder is a tool to help you work through complex business processes…"
          />
          {modalMode !== "off" && modalTextIsBlank && (
            <p className="text-xs text-destructive">
              The modal will not appear while the message is blank.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" size="sm" onClick={handleRestoreDefaults}>
            Restore default wording
          </Button>
          <Button
            type="button"
            data-testid="chat-disclaimer-save"
            onClick={handleSave}
            disabled={mutation.isPending || query.isLoading}
          >
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
