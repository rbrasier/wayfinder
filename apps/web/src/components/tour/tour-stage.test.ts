import { describe, it, expect } from "vitest";
import { parseTourStage, shouldShowWelcomeTour, TOUR_PARAM, withTourStage } from "./tour-stage";

describe("parseTourStage", () => {
  it("recognises the two stages the journey hands off through", () => {
    expect(parseTourStage("new-flow")).toBe("new-flow");
    expect(parseTourStage("flow-explainer")).toBe("flow-explainer");
  });

  it("ignores anything else, so a stray parameter cannot open a dialog", () => {
    expect(parseTourStage("evil")).toBeNull();
    expect(parseTourStage("")).toBeNull();
    expect(parseTourStage(null)).toBeNull();
    expect(parseTourStage(undefined)).toBeNull();
  });
});

describe("withTourStage", () => {
  it("appends the stage as the tour parameter", () => {
    expect(withTourStage("/flows", "new-flow")).toBe(`/flows?${TOUR_PARAM}=new-flow`);
    expect(withTourStage("/flows/abc/config", "flow-explainer")).toBe(
      `/flows/abc/config?${TOUR_PARAM}=flow-explainer`,
    );
  });
});

describe("shouldShowWelcomeTour", () => {
  const ready = {
    welcomeTourPending: true,
    organisationSignInStatus: "assigned",
    organisationPromptDismissed: false,
  };

  it("shows for a user whose tour is still pending", () => {
    expect(shouldShowWelcomeTour(ready)).toBe(true);
  });

  it("stays hidden once the tour has been completed", () => {
    expect(shouldShowWelcomeTour({ ...ready, welcomeTourPending: false })).toBe(false);
  });

  it("stays hidden until the user's state has loaded", () => {
    expect(shouldShowWelcomeTour({ ...ready, welcomeTourPending: undefined })).toBe(false);
    expect(shouldShowWelcomeTour({ ...ready, organisationSignInStatus: undefined })).toBe(false);
  });

  it("yields to the organisation nomination prompt rather than stacking on it", () => {
    expect(shouldShowWelcomeTour({ ...ready, organisationSignInStatus: "nominate" })).toBe(false);
  });

  // "Not now" closes the nomination dialog without writing anything, so
  // signInState reports "nominate" for good on a user who never picks an
  // organisation. Waiting on the status alone would hide the tour forever.
  it("shows once the nomination prompt is dismissed, even though the status stays nominate", () => {
    expect(
      shouldShowWelcomeTour({
        ...ready,
        organisationSignInStatus: "nominate",
        organisationPromptDismissed: true,
      }),
    ).toBe(true);
  });

  // The regression this rule exists to prevent: a "dismissed here" flag would
  // survive client-side navigation in the layout that hosts the gate, so a
  // restart from Settings would raise `welcomeTourPending` and still show
  // nothing. Completion is read from the server state alone.
  it("shows again whenever the tour is pending, however many times it was closed before", () => {
    expect(shouldShowWelcomeTour({ ...ready, welcomeTourPending: false })).toBe(false);
    expect(shouldShowWelcomeTour(ready)).toBe(true);
    expect(shouldShowWelcomeTour({ ...ready, welcomeTourPending: false })).toBe(false);
    expect(shouldShowWelcomeTour(ready)).toBe(true);
  });
});
