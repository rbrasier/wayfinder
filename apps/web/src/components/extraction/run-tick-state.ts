// Pure decision for whether the run screen should drive the batch engine.
//
// A run only advances when something ticks it. The background poller in
// `apps/api` does that, but it may be disabled or on a slower cadence than an
// operator watching the screen, so the run screen ticks the run itself while it
// is live. The rules that keep that from becoming a hot loop:
//
// - only a `running` run is claimable — every other status is a stop the
//   operator resumes from, or terminal
// - never overlap a tick already in flight
// - stop after a failed tick; the background worker keeps retrying

export interface RunTickState {
  status: string | undefined;
  tickInFlight: boolean;
  tickBlocked: boolean;
}

export const shouldDriveTick = ({ status, tickInFlight, tickBlocked }: RunTickState): boolean =>
  status === "running" && !tickInFlight && !tickBlocked;

// Whether the run is doing work right now, which is what the spinner reflects.
export const isProcessing = (status: string | undefined): boolean => status === "running";
