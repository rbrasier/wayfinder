// Whether the start-of-chat disclaimer modal opens, and the browser-local
// record of what the user has already acknowledged. Kept out of the component so
// the decision can be asserted without rendering, and so every storage access
// goes through one guarded path.

import {
  chatDisclaimerAcknowledgementKey,
  type ChatDisclaimerConfig,
} from "@rbrasier/domain";

export const ACKNOWLEDGED_VALUE = "acknowledged";

// The subset of the Storage API this needs. Narrower than Storage so a test can
// supply a plain object, and so a browser that exposes a partial shim still fits.
export interface AcknowledgementStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

// A browser set to block site data throws on access rather than returning null,
// and a thumbnail or preview context may expose no storage at all. Either way the
// answer is "not acknowledged": showing the warning twice is the safe failure.
export const hasAcknowledgedDisclaimer = (
  storage: AcknowledgementStorage | null,
  key: string | null,
): boolean => {
  if (!storage || !key) return false;
  try {
    return storage.getItem(key) === ACKNOWLEDGED_VALUE;
  } catch {
    return false;
  }
};

export const rememberDisclaimerAcknowledgement = (
  storage: AcknowledgementStorage | null,
  key: string | null,
): void => {
  if (!storage || !key) return;
  try {
    storage.setItem(key, ACKNOWLEDGED_VALUE);
  } catch {
    // A user who cannot persist the acknowledgement still gets to dismiss the
    // modal for this visit; it simply returns next time.
  }
};

export const shouldOpenDisclaimerModal = (
  config: ChatDisclaimerConfig | null,
  userId: string,
  sessionId: string,
  storage: AcknowledgementStorage | null,
): boolean => {
  if (!config) return false;
  const key = chatDisclaimerAcknowledgementKey(config, userId, sessionId);
  if (!key) return false;
  return !hasAcknowledgedDisclaimer(storage, key);
};
