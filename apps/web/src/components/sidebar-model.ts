import type { SessionStatus } from "@wayfinder/domain";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// Rail-sized ages. Under a day reads as elapsed time ("17h ago"); past that it
// compacts to a bare count ("3d"), which is what the design mockup shows and
// what keeps a two-line card from wrapping.
export const relativeAge = (timestamp: Date, now: Date = new Date()): string => {
  const elapsed = now.getTime() - new Date(timestamp).getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  return `${Math.floor(elapsed / WEEK)}w`;
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  active: "In progress",
  complete: "Done",
  abandoned: "Abandoned",
  cancelled: "Cancelled",
};

export const recentChatStatusLabel = (status: SessionStatus): string => STATUS_LABEL[status];

export const formatRecentChatMeta = (
  status: SessionStatus,
  updatedAt: Date,
  now: Date = new Date(),
): string => `${recentChatStatusLabel(status)} · ${relativeAge(updatedAt, now)}`;

// How many chats the Recent block shows. The rail scrolls, so this is not what
// keeps the footer on screen — it is what keeps the scroll itself short enough
// to be worth doing, on an account with hundreds of chats.
export const RECENT_CHATS_LIMIT = 8;

// Structural subset of a session — the rail decides what to show from these two
// alone, so the helper does not need the whole list payload to be testable.
interface RecentChatCandidate {
  id: string;
  status: SessionStatus;
}

// Which chats the Recent block shows, in the order given. Abandoned chats are
// dropped before the cap is applied, not after: a run of abandoned chats at the
// top would otherwise eat the whole allowance and leave the block near-empty.
export const recentChatSessions = <T extends RecentChatCandidate>(sessions: readonly T[]): T[] =>
  sessions.filter((session) => session.status !== "abandoned").slice(0, RECENT_CHATS_LIMIT);

// Which single rail item is active. Resolved across the whole candidate set
// rather than per-item, because "is this href a prefix of the path" is true for
// every ancestor at once — which is how /chats and /chats/<id> both came to
// highlight. The most specific match wins, and only it.
//
// Matching is segment-boundary aware, so /chat never claims /chats.
export const resolveActiveHref = (
  pathname: string,
  candidates: readonly string[],
): string | null => {
  const matches = candidates.filter(
    (href) => pathname === href || pathname.startsWith(href.endsWith("/") ? href : `${href}/`),
  );
  if (matches.length === 0) return null;
  return matches.reduce((longest, href) => (href.length > longest.length ? href : longest));
};

// Structural subset of KeyboardEvent — enough to decide the binding without
// requiring a DOM in the tests.
interface ShortcutEvent {
  // Autofill, password managers and IME composition can dispatch keydown events
  // with no key, so this cannot be assumed to be a string.
  key: string | undefined;
  metaKey: boolean;
  ctrlKey: boolean;
  target: { tagName?: string; isContentEditable?: boolean } | null;
}

const EDITABLE_TAGS = ["INPUT", "TEXTAREA", "SELECT"];

const isEditableTarget = (target: ShortcutEvent["target"]): boolean => {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  return EDITABLE_TAGS.includes(target.tagName ?? "");
};

export const isNewChatShortcut = (event: ShortcutEvent): boolean => {
  if (event.key?.toLowerCase() !== "k") return false;
  if (!event.metaKey && !event.ctrlKey) return false;
  return !isEditableTarget(event.target);
};
