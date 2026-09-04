// The welcome tour crosses two page loads — the flows list and the configure
// canvas — and hands off between them through this URL parameter (ADR-056 §2).
export const TOUR_PARAM = "tour";

export type TourStage = "new-flow" | "flow-explainer";

const STAGES: readonly TourStage[] = ["new-flow", "flow-explainer"];

export const parseTourStage = (value: string | null | undefined): TourStage | null =>
  STAGES.find((stage) => stage === value) ?? null;

export const withTourStage = (path: string, stage: TourStage): string =>
  `${path}?${TOUR_PARAM}=${stage}`;

// The welcome gate rule: pending, both queries settled, not dismissed on this
// page, and never on top of the organisation nomination dialog (ADR-056 §4).
export const shouldShowWelcomeTour = (input: {
  welcomeTourPending: boolean | undefined;
  organisationSignInStatus: string | undefined;
  dismissed: boolean;
}): boolean => {
  if (input.dismissed) return false;
  if (input.welcomeTourPending !== true) return false;
  if (input.organisationSignInStatus === undefined) return false;
  return input.organisationSignInStatus !== "nominate";
};
