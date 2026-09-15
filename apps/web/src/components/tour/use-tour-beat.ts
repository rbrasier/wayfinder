"use client";

import { useEffect, useState } from "react";
import { advanceBeat, beatDelay, restingBeat } from "./tour-beat-model";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

const usePrefersReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    setReduced(media.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
};

// Cycles 0 … durations.length-1 and loops; under reduced motion it pins to the
// final beat so the illustration shows its finished state and never moves.
// `durations` must be a stable reference (a module constant).
export function useTourBeat(durations: readonly number[]): number {
  const reduced = usePrefersReducedMotion();
  const [beat, setBeat] = useState(0);

  useEffect(() => {
    if (reduced) {
      setBeat(restingBeat(durations));
      return;
    }
    const timer = setTimeout(
      () => setBeat((current) => advanceBeat(current, durations.length)),
      beatDelay(beat, durations),
    );
    return () => clearTimeout(timer);
  }, [beat, reduced, durations]);

  return beat;
}
