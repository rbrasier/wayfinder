"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

// Three prompts can want the screen straight after sign-in, in this order: the
// sign-in notice (ADR-060 §5), the organisation nomination gate (ADR-038 §4) and
// the welcome tour (ADR-056 §4). Each later one yields to those before it. The
// notice goes first because it blocks the app until acknowledged — a
// nomination dialog stacked over it would be unreachable. The tour yields to the
// nomination prompt, so it has to know when that prompt has gone — which its
// server state cannot say, because "Not now" closes the dialog without writing
// anything and `signInState` keeps reporting "nominate". Holding both facts here
// lets every gate read them.
interface SignInPromptsValue {
  loginNoticeCleared: boolean;
  clearLoginNotice: () => void;
  organisationPromptDismissed: boolean;
  dismissOrganisationPrompt: () => void;
}

// Outside a provider (the admin layout mounts the notice gate on its own) there
// is nothing to hold back, so the notice counts as cleared.
const SignInPromptsContext = createContext<SignInPromptsValue>({
  loginNoticeCleared: true,
  clearLoginNotice: () => {},
  organisationPromptDismissed: false,
  dismissOrganisationPrompt: () => {},
});

export function SignInPromptsProvider({ children }: { children: ReactNode }) {
  // Deliberately per-mount, matching the prompt it replaces: a full page load
  // re-offers the nomination dialog to a user who has not chosen yet.
  const [organisationPromptDismissed, setOrganisationPromptDismissed] = useState(false);
  const [loginNoticeCleared, setLoginNoticeCleared] = useState(false);
  // Stable, because the notice gate calls it from an effect.
  const clearLoginNotice = useCallback(() => setLoginNoticeCleared(true), []);
  return (
    <SignInPromptsContext.Provider
      value={{
        loginNoticeCleared,
        clearLoginNotice,
        organisationPromptDismissed,
        dismissOrganisationPrompt: () => setOrganisationPromptDismissed(true),
      }}
    >
      {children}
    </SignInPromptsContext.Provider>
  );
}

export const useSignInPrompts = (): SignInPromptsValue => useContext(SignInPromptsContext);
