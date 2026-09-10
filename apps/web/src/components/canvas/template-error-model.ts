// The error strip in the template modal. A template upload can fail for one
// reason ("Could not read that document") or for a hundred — one per malformed
// {{ tag }} — so the strip is a headline plus an optional list rather than a
// single string (issue #286).
export interface TemplateErrorDetail {
  subject: string;
  message: string;
}

export interface TemplateError {
  headline: string;
  details: TemplateErrorDetail[];
}

// The API payload is JSON off the wire: an older server, a proxy error page or a
// crash can put anything in `details`, so every entry is checked before it
// reaches the DOM. Entries missing either half are dropped — a row with no text
// to point at is worse than no row.
const readDetails = (value: unknown): TemplateErrorDetail[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const detail = entry as Partial<TemplateErrorDetail> | null;
    const subject = typeof detail?.subject === "string" ? detail.subject.trim() : "";
    const message = typeof detail?.message === "string" ? detail.message.trim() : "";
    if (!subject || !message) return [];
    return [{ subject, message }];
  });
};

// Word repeats a header on every page, so one malformed tag in it is reported
// once per page — identical rows would read as many separate mistakes.
const dedupe = (details: TemplateErrorDetail[]): TemplateErrorDetail[] => {
  const seen = new Set<string>();
  return details.filter((detail) => {
    const key = `${detail.subject} ${detail.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const toTemplateError = (payload: unknown, fallback: string): TemplateError => {
  const body = payload as { error?: unknown; details?: unknown } | null;
  const headline = typeof body?.error === "string" && body.error.trim() ? body.error : fallback;
  return { headline, details: dedupe(readDetails(body?.details)) };
};
