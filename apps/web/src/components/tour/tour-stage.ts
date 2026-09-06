// The welcome tour crosses two page loads — the flows list and the configure
// canvas — and hands off between them through this URL parameter (ADR-056 §2).
export const TOUR_PARAM = "tour";

export type TourStage = "new-flow" | "flow-explainer";

const STAGES: readonly TourStage[] = ["new-flow", "flow-explainer"];

export const parseTourStage = (value: string | null | undefined): TourStage | null =>
  STAGES.find((stage) => stage === value) ?? null;

export const withTourStage = (path: string, stage: TourStage): string =>
  `${path}?${TOUR_PARAM}=${stage}`;

// The welcome gate rule: pending, both queries settled, and never on top of the
// organisation nomination dialog (ADR-056 §4).
//
// Deliberately free of any "dismissed on this page" flag. The gate lives in the
// (user) layout, which stays mounted across client-side navigation, so such a
// flag outlives the tour it closed and swallows every later restart from
// Settings. Closing the tour writes the completion straight into the `user.me`
// cache instead, which a restart then legitimately overturns.
export const shouldShowWelcomeTour = (input: {
  welcomeTourPending: boolean | undefined;
  organisationSignInStatus: string | undefined;
  organisationPromptDismissed: boolean;
}): boolean => {
  if (input.welcomeTourPending !== true) return false;
  if (input.organisationSignInStatus === undefined) return false;
  // Yield only while the nomination dialog is actually on screen. Its "Not now"
  // writes nothing, so signInState stays "nominate" for good on a user who
  // never picks an organisation — waiting on the status alone would hide the
  // tour from them permanently.
  if (input.organisationSignInStatus !== "nominate") return true;
  return input.organisationPromptDismissed;
};
