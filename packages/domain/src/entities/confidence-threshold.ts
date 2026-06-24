// The advance/confirmation confidence threshold is authored as a plain number
// on a node's config, but nothing validates its scale on write and no in-app UI
// writes it — so an imported, seeded, or AI-generated flow can store it as a
// fraction (0.7) instead of a 0-100 percentage (70). The engine compares it
// against a 0-100 confidence, so a fractional value makes every turn advance.
// Normalising on read is the single guard that protects all such data.

export const DEFAULT_ADVANCE_CONFIDENCE_THRESHOLD = 90;

export const normaliseAdvanceConfidenceThreshold = (value: number | undefined | null): number => {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return DEFAULT_ADVANCE_CONFIDENCE_THRESHOLD;
  }

  // A value in (0, 1] is a fraction the author meant as a percentage: 1 is the
  // whole (100%), not 1%. Scale it onto the 0-100 confidence scale.
  const scaled = value > 0 && value <= 1 ? value * 100 : value;

  return Math.min(100, Math.max(0, scaled));
};
