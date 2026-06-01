// Pure chunking utility. Splits extracted document text into overlapping
// windows sized for embedding (~500 tokens by default, ~50 tokens overlap).
// Token counts are approximated as 4 characters per token — good enough for
// sizing chunks without pulling in a tokeniser dependency.

const CHARS_PER_TOKEN = 4;

export interface ChunkOptions {
  targetTokens?: number;
  overlapTokens?: number;
  // Templates carry {{ variable }} placeholders that add noise to embeddings
  // without semantic signal (see phase doc §7) — strip them before chunking.
  stripPlaceholders?: boolean;
}

const PLACEHOLDER_PATTERN = /\{\{.*?\}\}/g;

const splitIntoParagraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

const splitIntoSentences = (paragraph: string): string[] => {
  const sentences = paragraph.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g);
  return sentences ? sentences.map((sentence) => sentence.trim()).filter(Boolean) : [paragraph];
};

// Breaks a unit (paragraph or sentence) that on its own exceeds the budget into
// hard character slices so no single piece can blow the chunk size unbounded.
const hardSplit = (unit: string, maxChars: number): string[] => {
  if (unit.length <= maxChars) return [unit];
  const pieces: string[] = [];
  for (let start = 0; start < unit.length; start += maxChars) {
    pieces.push(unit.slice(start, start + maxChars));
  }
  return pieces;
};

const buildUnits = (text: string, maxChars: number): string[] => {
  const units: string[] = [];
  for (const paragraph of splitIntoParagraphs(text)) {
    if (paragraph.length <= maxChars) {
      units.push(paragraph);
      continue;
    }
    for (const sentence of splitIntoSentences(paragraph)) {
      units.push(...hardSplit(sentence, maxChars));
    }
  }
  return units;
};

const overlapTail = (chunk: string, overlapChars: number): string => {
  if (overlapChars <= 0 || chunk.length <= overlapChars) return chunk;
  const tail = chunk.slice(chunk.length - overlapChars);
  const firstSpace = tail.indexOf(" ");
  // Start the overlap at a word boundary so we do not slice mid-word.
  return firstSpace > 0 ? tail.slice(firstSpace + 1) : tail;
};

export const chunkText = (text: string, options: ChunkOptions = {}): string[] => {
  const targetTokens = options.targetTokens ?? 500;
  const overlapTokens = options.overlapTokens ?? 50;
  const maxChars = targetTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  const cleaned = options.stripPlaceholders
    ? text.replace(PLACEHOLDER_PATTERN, " ").replace(/[ \t]{2,}/g, " ")
    : text;

  const units = buildUnits(cleaned, maxChars);
  if (units.length === 0) return [];

  const chunks: string[] = [];
  let current = "";

  for (const unit of units) {
    if (current.length === 0) {
      current = unit;
      continue;
    }
    if (current.length + 2 + unit.length <= maxChars) {
      current = `${current}\n\n${unit}`;
      continue;
    }
    chunks.push(current);
    const overlap = overlapTail(current, overlapChars);
    current = overlap.length > 0 ? `${overlap}\n\n${unit}` : unit;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
};
