"use client";

import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

// Two first-run prompts can want the screen straight after sign-in: the
// organisation nomination gate (ADR-038 §4) and the welcome tour (ADR-056 §4).
// The tour yields to the nomination prompt, so it has to know when that prompt
// has gone — which its server state cannot say, because "Not now" closes the
// dialog without writing anything and `signInState` keeps reporting "nominate".
// Holding the dismissal here lets both gates read the same fact.
interface SignInPromptsValue {
  organisationPromptDismissed: boolean;
  dismissOrganisationPrompt: () => void;
}

const SignInPromptsContext = createContext<SignInPromptsValue>({
  organisationPromptDismissed: false,
  dismissOrganisationPrompt: () => {},
});

export function SignInPromptsProvider({ children }: { children: ReactNode }) {
  // Deliberately per-mount, matching the prompt it replaces: a full page load
  // re-offers the nomination dialog to a user who has not chosen yet.
  const [organisationPromptDismissed, setOrganisationPromptDismissed] = useState(false);
  return (
    <SignInPromptsContext.Provider
      value={{
        organisationPromptDismissed,
        dismissOrganisationPrompt: () => setOrganisationPromptDismissed(true),
      }}
    >
      {children}
    </SignInPromptsContext.Provider>
  );
}

export const useSignInPrompts = (): SignInPromptsValue => useContext(SignInPromptsContext);
