// Sequencing for the explainer illustrations (ADR-056 §3): each illustration is
// a list of beats, elements render from the beat they belong to, and CSS does
// the drawing. Kept pure so the loop is testable without a clock.

const FALLBACK_DELAY_MS = 1000;

export const advanceBeat = (beat: number, beatCount: number): number => (beat + 1) % beatCount;

export const beatDelay = (beat: number, durations: readonly number[]): number =>
  durations[beat] ?? FALLBACK_DELAY_MS;

// Where an illustration rests when it must not move: its finished frame.
export const restingBeat = (durations: readonly number[]): number => durations.length - 1;
