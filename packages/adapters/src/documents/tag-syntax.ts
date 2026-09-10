import { parseTemplateField } from "@rbrasier/domain";
import type { DomainErrorDetail } from "@rbrasier/domain";

// Shared {{ tag }} syntax checking for the .docx and .xlsx generators. Both read
// tags with a non-greedy /\{\{([\s\S]*?)\}\}/, which spans a mistyped opening
// brace forward into the next well-formed tag — so two fields silently become
// one nonsense field and nothing downstream ever sees a problem (issue #286).

const TAG_OPEN = "{{";
const TAG_CLOSE = "}}";

// Characters of surrounding prose quoted either side of a broken tag. Enough to
// find the spot by eye in Word or Excel; short enough to list a hundred of them.
const TAG_CONTEXT_CHARS = 60;

export const UNCLOSED_TAG_MESSAGE = 'A tag opens with "{{" but never closes with "}}".';
export const UNOPENED_TAG_MESSAGE = 'A "}}" closes a tag that was never opened with "{{".';
export const STRAY_BRACE_MESSAGE = 'A tag has a stray "{" or "}" inside it.';

// docxtemplater's own vocabulary, restated for a template author who has never
// heard of it. Anything not listed falls back to its `explanation`.
const DOCXTEMPLATER_TAG_MESSAGES: Record<string, string> = {
  unopened_tag: UNOPENED_TAG_MESSAGE,
  unclosed_tag: UNCLOSED_TAG_MESSAGE,
  duplicate_open_tag: 'A tag opens with "{{" twice. Remove the extra brace pair.',
  duplicate_close_tag: 'A tag closes with "}}" twice. Remove the extra brace pair.',
  unbalanced_loop_tags: "A {{#section}} is missing its matching {{/section}}.",
  closing_tag_does_not_match_opening_tag:
    "A {{/section}} closes a different section from the one that is open.",
};

interface DocxtemplaterErrorProperties {
  id?: string;
  explanation?: string;
  context?: string;
  xtag?: string;
  errors?: unknown[];
}

// One malformed run of text, addressed by character offsets into the text it
// was found in.
interface TagScanIssue {
  start: number;
  end: number;
  message: string;
}

// The headline a caller puts on a DomainError carrying these details. A lone
// issue speaks for itself; several need counting so the reader knows to look
// down the list.
export const headlineFor = (details: readonly DomainErrorDetail[]): string => {
  if (details.length === 1) return details[0]!.message;
  return `${details.length} tags in this template are not correctly formed. Fix each one listed below, then upload it again.`;
};

const quoteContext = (text: string, start: number, end: number): string => {
  const from = Math.max(0, start - TAG_CONTEXT_CHARS);
  const to = Math.min(text.length, end + TAG_CONTEXT_CHARS);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return `${prefix}${text.slice(from, to).trim()}${suffix}`;
};

// Requires "{{" and "}}" to strictly alternate. Single braces are left alone:
// "{ key: value }" in prose is not a tag, and never has been.
const scanDelimiters = (text: string): TagScanIssue[] => {
  const issues: TagScanIssue[] = [];
  let openAt: number | null = null;
  let cursor = 0;

  for (;;) {
    const nextOpen = text.indexOf(TAG_OPEN, cursor);
    const nextClose = text.indexOf(TAG_CLOSE, cursor);
    if (nextOpen < 0 && nextClose < 0) break;

    const opensNext = nextOpen >= 0 && (nextClose < 0 || nextOpen < nextClose);

    if (opensNext && openAt !== null) {
      issues.push({ start: openAt, end: nextOpen + TAG_OPEN.length, message: UNCLOSED_TAG_MESSAGE });
      openAt = nextOpen;
      cursor = nextOpen + TAG_OPEN.length;
      continue;
    }

    if (opensNext) {
      openAt = nextOpen;
      cursor = nextOpen + TAG_OPEN.length;
      continue;
    }

    if (openAt === null) {
      issues.push({
        start: nextClose,
        end: nextClose + TAG_CLOSE.length,
        message: UNOPENED_TAG_MESSAGE,
      });
      cursor = nextClose + TAG_CLOSE.length;
      continue;
    }

    const body = text.slice(openAt + TAG_OPEN.length, nextClose);
    if (/[{}]/.test(body)) {
      issues.push({ start: openAt, end: nextClose + TAG_CLOSE.length, message: STRAY_BRACE_MESSAGE });
    }
    openAt = null;
    cursor = nextClose + TAG_CLOSE.length;
  }

  if (openAt !== null) {
    issues.push({ start: openAt, end: text.length, message: UNCLOSED_TAG_MESSAGE });
  }

  return issues;
};

// Every malformed tag in one run of text — a .docx paragraph, an .xlsx cell —
// quoted with enough surrounding prose to locate it. `where` names the part it
// came from, e.g. " (in a page header)"; pass "" when the text is the document.
export const tagSyntaxIssues = (text: string, where = ""): DomainErrorDetail[] =>
  scanDelimiters(text).map((issue) => ({
    subject: quoteContext(text, issue.start, issue.end),
    message: `${issue.message}${where}`,
  }));

// docxtemplater reports every malformed tag it found in one "multi_error", each
// entry carrying the offending text and why it is wrong. Collapsing that into a
// single generic sentence is what left an author hunting through a hundred tags
// for the one that is broken.
export const detailsFromCause = (cause: unknown): DomainErrorDetail[] => {
  const properties = (cause as { properties?: DocxtemplaterErrorProperties } | null)?.properties;
  if (!properties) return [];
  if (Array.isArray(properties.errors)) return properties.errors.flatMap(detailsFromCause);

  const subject = (properties.context ?? properties.xtag ?? "").trim();
  if (!subject) return [];
  const message = properties.id ? DOCXTEMPLATER_TAG_MESSAGES[properties.id] : undefined;
  return [{ subject, message: message ?? properties.explanation ?? UNCLOSED_TAG_MESSAGE }];
};

// parseTemplateFields stops at the first tag it cannot parse. Re-running the
// per-tag parser over all of them turns "one of your tags is wrong" into a list.
export const detailsFromTagContent = (rawTags: string[]): DomainErrorDetail[] =>
  rawTags.flatMap((rawTag) => {
    const parsed = parseTemplateField(rawTag);
    if (!parsed.error) return [];
    return [{ subject: rawTag, message: parsed.error.message }];
  });
