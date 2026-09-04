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
  const ready = { welcomeTourPending: true, organisationSignInStatus: "assigned", dismissed: false };

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

  it("stays hidden for the rest of the page once dismissed, even before the server confirms", () => {
    expect(shouldShowWelcomeTour({ ...ready, dismissed: true })).toBe(false);
  });
});
