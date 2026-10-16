// Coarsest boundary first: a paragraph keeps a thought together, a line keeps
// a feed entry or table row together. Only a run with neither is cut mid-text.
const BOUNDARIES = ["\n\n", "\n"];

const hardCut = (text: string, maxChars: number): string[] => {
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += maxChars) {
    pieces.push(text.slice(start, start + maxChars));
  }
  return pieces;
};

// Greedily joins pieces back together with their separator while the result
// still fits, so a split yields as few parts (and model calls) as it can.
const pack = (pieces: string[], separator: string, maxChars: number): string[] => {
  const packed: string[] = [];
  let current = "";
  for (const piece of pieces) {
    const candidate = current.length === 0 ? piece : `${current}${separator}${piece}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current.length > 0) packed.push(current);
    current = piece;
  }
  if (current.length > 0) packed.push(current);
  return packed;
};

const splitAt = (text: string, maxChars: number, boundaryIndex: number): string[] => {
  if (text.length <= maxChars) return [text];
  const separator = BOUNDARIES[boundaryIndex];
  if (separator === undefined) return hardCut(text, maxChars);

  const pieces = text
    .split(separator)
    .flatMap((piece) => splitAt(piece, maxChars, boundaryIndex + 1));
  return pack(pieces, separator, maxChars);
};

// Splits one document's text into segments of at most `maxChars`, preferring
// paragraph, then line boundaries (issue #335).
export const splitDocumentText = (text: string, maxChars: number): string[] =>
  splitAt(text, Math.max(1, Math.floor(maxChars)), 0);
