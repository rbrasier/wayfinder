import type { TextEditLink } from "@wayfinder/domain";

export interface DraftComparisonPayload {
  originalText: string;
  taggedText: string;
  links: TextEditLink[];
}

export interface ComparedSegment {
  text: string;
  // Shared by a replaced value and its placeholder, so hovering one can light
  // up the other. Null for text the draft left alone.
  linkId: number | null;
}

export interface ComparedParagraph {
  changed: boolean;
  original: ComparedSegment[];
  tagged: ComparedSegment[];
}

type Side = "original" | "tagged";

const spanOf = (link: TextEditLink, side: Side) =>
  side === "original"
    ? { start: link.originalStart, end: link.originalEnd }
    : { start: link.taggedStart, end: link.taggedEnd };

// Cuts one side of the text into paragraphs of segments. A drafted edit never
// spans a paragraph break, so paragraph N of the original always pairs with
// paragraph N of the tagged text.
const segmentsBySide = (text: string, links: TextEditLink[], side: Side): ComparedSegment[][] => {
  const paragraphs: ComparedSegment[][] = [];
  let lineStart = 0;

  for (const line of text.split("\n")) {
    const lineEnd = lineStart + line.length;
    const segments: ComparedSegment[] = [];
    let cursor = lineStart;

    links.forEach((link, linkId) => {
      const span = spanOf(link, side);
      if (span.start < lineStart || span.end > lineEnd) return;
      if (span.start > cursor) segments.push({ text: text.slice(cursor, span.start), linkId: null });
      segments.push({ text: text.slice(span.start, span.end), linkId });
      cursor = span.end;
    });

    if (cursor < lineEnd || segments.length === 0) segments.push({ text: text.slice(cursor, lineEnd), linkId: null });
    paragraphs.push(segments);
    lineStart = lineEnd + 1;
  }

  return paragraphs;
};

export const buildComparison = (comparison: DraftComparisonPayload): ComparedParagraph[] => {
  if (!comparison.originalText) return [];

  const original = segmentsBySide(comparison.originalText, comparison.links, "original");
  const tagged = segmentsBySide(comparison.taggedText, comparison.links, "tagged");

  return original.map((segments, index) => {
    const taggedSegments = tagged[index] ?? [];
    return {
      changed: taggedSegments.some((segment) => segment.linkId !== null),
      original: segments,
      tagged: taggedSegments,
    };
  });
};
