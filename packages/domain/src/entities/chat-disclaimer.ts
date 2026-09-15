// The two AI-verification disclaimers in the chat surface: the line under the
// composer, and the modal shown when a chat is opened. Admin-authored and stored
// as one JSON row in admin_system_settings (ADR-041), so an operator can reword
// them — or turn them off — without a redeploy.

// A closed set: the mode crosses the wire and decides whether a user is
// interrupted, so an unrecognised stored string falls back to "off" rather than
// being trusted.
export const CHAT_DISCLAIMER_MODAL_MODES = ["off", "once", "every_session"] as const;

export type ChatDisclaimerModalMode = (typeof CHAT_DISCLAIMER_MODAL_MODES)[number];

export interface ChatDisclaimerConfig {
  // Blank means no line renders under the composer at all.
  composerText: string;
  modalMode: ChatDisclaimerModalMode;
  modalText: string;
}

export const CHAT_DISCLAIMER_CONFIG_SETTING_KEY = "chat_disclaimer_config";

export const DEFAULT_CHAT_DISCLAIMER_COMPOSER_TEXT =
  "Wayfinder asks follow up questions and signals when each step is complete. AI can make mistakes, and requires human verification";

export const DEFAULT_CHAT_DISCLAIMER_MODAL_TEXT =
  "Wayfinder is a tool to help you work through complex business processes. AI can make mistakes — all output needs to be verified by you before it is relied on.";

// The modal ships off: an upgrade must not introduce an interruption nobody
// asked for. The message is still populated so enabling it is a one-click change.
export const createDefaultChatDisclaimerConfig = (): ChatDisclaimerConfig => ({
  composerText: DEFAULT_CHAT_DISCLAIMER_COMPOSER_TEXT,
  modalMode: "off",
  modalText: DEFAULT_CHAT_DISCLAIMER_MODAL_TEXT,
});

const isChatDisclaimerModalMode = (value: unknown): value is ChatDisclaimerModalMode =>
  typeof value === "string" &&
  (CHAT_DISCLAIMER_MODAL_MODES as readonly string[]).includes(value);

// Tolerant parse: a malformed row degrades field by field rather than throwing on
// a path that runs for every chat render.
export const parseChatDisclaimerConfig = (
  raw: string,
  fallback: ChatDisclaimerConfig = createDefaultChatDisclaimerConfig(),
): ChatDisclaimerConfig => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fallback;
    const source = parsed as Record<string, unknown>;
    return {
      // An empty string is a value here — it is how an admin hides the line — so
      // it is honoured rather than filled in from the fallback.
      composerText:
        typeof source.composerText === "string" ? source.composerText : fallback.composerText,
      modalMode: isChatDisclaimerModalMode(source.modalMode) ? source.modalMode : fallback.modalMode,
      modalText: typeof source.modalText === "string" ? source.modalText : fallback.modalText,
    };
  } catch {
    return fallback;
  }
};

export const resolveChatDisclaimerComposerText = (config: ChatDisclaimerConfig): string | null => {
  const trimmed = config.composerText.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// An enabled modal with nothing to say would block the chat behind an empty box,
// so blank text disables it just as firmly as the mode does.
export const isChatDisclaimerModalEnabled = (config: ChatDisclaimerConfig): boolean =>
  config.modalMode !== "off" && config.modalText.trim().length > 0;

// Identifies what the user has already acknowledged. In "once" mode that is the
// user; in "every_session" mode it is the user on this chat, so revisiting a chat
// does not re-prompt but opening a new one does. Null means nothing to store,
// because the modal is not showing.
export const chatDisclaimerAcknowledgementKey = (
  config: ChatDisclaimerConfig,
  userId: string,
  sessionId: string,
): string | null => {
  if (!isChatDisclaimerModalEnabled(config)) return null;
  if (config.modalMode === "once") return `wayfinder.chat-disclaimer.once.${userId}`;
  return `wayfinder.chat-disclaimer.session.${userId}.${sessionId}`;
};
