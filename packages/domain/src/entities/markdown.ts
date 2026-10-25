// Pure markdown reader for assistant replies. The model often answers with
// markdown ("**What's the challenge?**"), which used to reach the browser as
// literal asterisks.
//
// This is deliberately a small subset rather than a full CommonMark
// implementation: emphasis, code, links, bullets and headings are what the
// assistant actually emits. It produces a node tree instead of an HTML string so
// the renderer can build React elements — nothing is ever injected as raw HTML.

export type InlineNode =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "code"; readonly value: string }
  | { readonly type: "link"; readonly href: string; readonly children: InlineNode[] }
  | { readonly type: "bold"; readonly children: InlineNode[] }
  | { readonly type: "italic"; readonly children: InlineNode[] }
  | { readonly type: "strike"; readonly children: InlineNode[] };

export type MarkdownBlock =
  // Headings carry no level: the chat bubble renders every heading at body size
  // so a reply can never blow up the conversation's type scale.
  | { readonly type: "heading"; readonly content: string }
  | { readonly type: "paragraph"; readonly content: string }
  | { readonly type: "list"; readonly ordered: boolean; readonly items: string[] }
  | { readonly type: "code"; readonly value: string };

const HEADING_PATTERN = /^ {0,3}#{1,6}\s+(.*)$/;
const UNORDERED_ITEM_PATTERN = /^\s*[-*+]\s+(.*)$/;
const ORDERED_ITEM_PATTERN = /^\s*\d+[.)]\s+(.*)$/;
const FENCE_PATTERN = /^\s*```/;

// The model returns its reply inside a JSON "response" field, and sometimes
// escapes the escape — writing `\\n` where `\n` was meant — so the decoded
// string carries the two characters `\` and `n` instead of a line break. Left
// alone those are not just visible: the whole reply becomes one line, so no
// heading, bullet or numbered list in it is recognised either.
const ESCAPED_LINE_BREAK_PATTERN = /\\r\\n|\\r|\\n/g;

// Anything else — notably `javascript:` — renders as literal text rather than
// becoming a clickable link.
const SAFE_HREF_PATTERN = /^(https?:\/\/|mailto:)/i;

const isWordCharacter = (character: string | undefined): boolean =>
  character !== undefined && /[\w]/.test(character);

interface InlineMatch {
  readonly node: InlineNode;
  readonly length: number;
}

const matchCode = (rest: string): InlineMatch | null => {
  const match = /^`([^`]+)`/.exec(rest);
  if (!match) return null;
  return { node: { type: "code", value: match[1] as string }, length: match[0].length };
};

const matchLink = (rest: string): InlineMatch | null => {
  const match = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest);
  if (!match) return null;
  const href = match[2] as string;
  if (!SAFE_HREF_PATTERN.test(href)) return null;
  return {
    node: { type: "link", href, children: parseInline(match[1] as string) },
    length: match[0].length,
  };
};

// Emphasis content may not begin with whitespace, which is what keeps
// "2 * 3 * 4" arithmetic rather than an italic run.
const matchWrapped = (
  rest: string,
  delimiter: string,
  type: "bold" | "italic" | "strike",
): InlineMatch | null => {
  if (!rest.startsWith(delimiter)) return null;
  const closing = rest.indexOf(delimiter, delimiter.length);
  if (closing === -1) return null;
  const inner = rest.slice(delimiter.length, closing);
  if (inner.length === 0) return null;
  if (/^\s/.test(inner)) return null;
  return {
    node: { type, children: parseInline(inner) },
    length: closing + delimiter.length,
  };
};

// `_` only delimits at word boundaries, so snake_case identifiers survive.
const matchUnderscore = (
  rest: string,
  input: string,
  index: number,
  delimiter: string,
  type: "bold" | "italic",
): InlineMatch | null => {
  if (isWordCharacter(input[index - 1])) return null;
  const match = matchWrapped(rest, delimiter, type);
  if (!match) return null;
  if (isWordCharacter(input[index + match.length])) return null;
  return match;
};

const matchInlineAt = (input: string, index: number): InlineMatch | null => {
  const rest = input.slice(index);
  return (
    matchCode(rest) ??
    matchLink(rest) ??
    matchWrapped(rest, "**", "bold") ??
    matchUnderscore(rest, input, index, "__", "bold") ??
    matchWrapped(rest, "~~", "strike") ??
    matchWrapped(rest, "*", "italic") ??
    matchUnderscore(rest, input, index, "_", "italic")
  );
};

export const parseInline = (input: string): InlineNode[] => {
  const nodes: InlineNode[] = [];
  let buffer = "";
  let index = 0;

  const flushBuffer = (): void => {
    if (buffer.length === 0) return;
    nodes.push({ type: "text", value: buffer });
    buffer = "";
  };

  while (index < input.length) {
    const match = matchInlineAt(input, index);
    if (!match) {
      buffer += input[index];
      index += 1;
      continue;
    }
    flushBuffer();
    nodes.push(match.node);
    index += match.length;
  }

  flushBuffer();
  return nodes;
};

const listItemOf = (line: string): { text: string; ordered: boolean } | null => {
  const ordered = ORDERED_ITEM_PATTERN.exec(line);
  if (ordered) return { text: (ordered[1] as string).trim(), ordered: true };
  const unordered = UNORDERED_ITEM_PATTERN.exec(line);
  if (unordered) return { text: (unordered[1] as string).trim(), ordered: false };
  return null;
};

// Fenced content is left exactly as it arrived, so a reply that deliberately
// shows an escape sequence in a code block keeps it.
const normaliseEscapedLineBreaks = (input: string): string => {
  let insideFence = false;

  return input
    .split("\n")
    .map((line) => {
      if (FENCE_PATTERN.test(line)) {
        insideFence = !insideFence;
        return line;
      }
      if (insideFence) return line;
      return line.replace(ESCAPED_LINE_BREAK_PATTERN, "\n");
    })
    .join("\n");
};

export const parseMarkdownBlocks = (input: string): MarkdownBlock[] => {
  const lines = normaliseEscapedLineBreaks(input).split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", content: paragraph.join("\n") });
    paragraph = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] as string;

    if (FENCE_PATTERN.test(line)) {
      flushParagraph();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE_PATTERN.test(lines[index] as string)) {
        body.push(lines[index] as string);
        index += 1;
      }
      // Skip the closing fence; an unterminated fence just ends at the input.
      index += 1;
      blocks.push({ type: "code", value: body.join("\n") });
      continue;
    }

    if (line.trim().length === 0) {
      flushParagraph();
      index += 1;
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ type: "heading", content: (heading[1] as string).trim() });
      index += 1;
      continue;
    }

    const item = listItemOf(line);
    if (item) {
      flushParagraph();
      const items: string[] = [item.text];
      const ordered = item.ordered;
      index += 1;
      while (index < lines.length) {
        const next = listItemOf(lines[index] as string);
        // Nested bullets flatten into the parent list — the assistant indents
        // freely and a raw "  - x" line reads worse than a flat bullet.
        if (!next || next.ordered !== ordered) break;
        items.push(next.text);
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    paragraph.push(line);
    index += 1;
  }

  flushParagraph();
  return blocks;
};
