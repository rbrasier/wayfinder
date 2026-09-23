import type { LoginNoticeConfig, LoginNoticeMode } from "@rbrasier/domain";

// Decisions behind the sign-in notice gate and its settings card (ADR-060 §5),
// kept out of the components so they can be asserted without rendering.

export interface LoginNoticeStatusView {
  readonly due: boolean;
  readonly text: string;
  readonly version: number;
}

// `acknowledgedVersion` is what this tab acknowledged, so the modal closes on the
// click rather than after a refetch.
export const shouldShowLoginNotice = (
  status: LoginNoticeStatusView | undefined,
  acknowledgedVersion: number | null,
): boolean => {
  if (!status?.due) return false;
  if (status.text.trim().length === 0) return false;
  return acknowledgedVersion !== status.version;
};

// Whether the other sign-in prompts (organisation, welcome tour) may show. They
// wait while the notice might still be due. A failed lookup clears the way: the
// notice is a governance nicety, and an outage must not lock everyone out.
export const isLoginNoticeCleared = (
  query: { readonly status: LoginNoticeStatusView | undefined; readonly failed: boolean },
  acknowledgedVersion: number | null,
): boolean => {
  if (query.failed) return true;
  if (!query.status) return false;
  return !shouldShowLoginNotice(query.status, acknowledgedVersion);
};

export const loginNoticeSaveHint = (
  saved: LoginNoticeConfig | undefined,
  draft: { readonly mode: LoginNoticeMode; readonly text: string },
): string | null => {
  if (draft.mode === "off") return null;
  if (draft.text.trim().length === 0) return "Add the notice text before turning it on.";
  if (saved && saved.text.length > 0 && draft.text !== saved.text) {
    return "Saving new wording asks everyone to acknowledge it again.";
  }
  return null;
};
