// The mock's hearings, worked out from the clock rather than stored, so every
// check — and a restarted mock — agrees on what is live. Time is cut into slots
// of one period: the hearing for the current slot is live, earlier ones have
// finished and later ones are scheduled. Each rollover therefore finishes one
// hearing and starts the next, which is the transition an Event Watch listens
// for. A hearing's id comes from its slot, so it never changes between checks.
//
// The shape is a stand-in for ParlView's hearing feed — reshape `toHearing` if
// the real one differs, and the Event Watch editor's field dropdowns follow.

export const DEFAULT_PERIOD_MS = 5 * 60 * 1000;

const FINISHED_SHOWN = 5;
const SCHEDULED_SHOWN = 2;

const COMMITTEES = [
  { name: "Finance and Public Administration Legislation Committee", portfolio: "Finance" },
  { name: "Economics Legislation Committee", portfolio: "Treasury" },
  { name: "Legal and Constitutional Affairs Legislation Committee", portfolio: "Home Affairs" },
  { name: "Community Affairs Legislation Committee", portfolio: "Health and Aged Care" },
  { name: "Foreign Affairs, Defence and Trade Legislation Committee", portfolio: "Defence" },
  { name: "Environment and Communications Legislation Committee", portfolio: "Climate Change, Energy, the Environment and Water" },
];

const TOPICS = [
  "program funding and underspends",
  "staffing levels and contractor use",
  "the timing of a delayed report",
  "procurement of a major ICT system",
  "responses to questions on notice",
];

const iso = (ms) => new Date(ms).toISOString();

const slotOf = (nowMs, periodMs) => Math.floor(nowMs / periodMs);

const statusOf = (slot, currentSlot) => {
  if (slot < currentSlot) return "finished";
  if (slot === currentSlot) return "live";
  return "scheduled";
};

const transcriptFor = (committee, topic) =>
  [
    `CHAIR: I declare open this public hearing of the Senate ${committee.name}.`,
    `We continue our examination of the ${committee.portfolio} portfolio.`,
    `Senator SMITH: I'd like to start with ${topic}. Can the department explain where things stand?`,
    "OFFICIAL: Thank you, Senator. I can give you an update and take the detail on notice.",
    `Senator JONES: Following on from that — has the minister been briefed on ${topic}?`,
    "OFFICIAL: The minister's office was briefed last month. I'll confirm the date on notice.",
    "CHAIR: Thank you. We will suspend for a short break.",
  ].join("\n");

const toHearing = (slot, currentSlot, periodMs) => {
  const committee = COMMITTEES[slot % COMMITTEES.length];
  const topic = TOPICS[slot % TOPICS.length];
  const status = statusOf(slot, currentSlot);
  const startMs = slot * periodMs;
  return {
    id: `pv-${slot}`,
    title: `Budget Estimates — ${committee.portfolio}`,
    committee: committee.name,
    chamber: "Senate",
    portfolio: committee.portfolio,
    status,
    scheduledStart: iso(startMs),
    startedAt: status === "scheduled" ? null : iso(startMs),
    finishedAt: status === "finished" ? iso(startMs + periodMs) : null,
    durationSeconds: status === "finished" ? Math.round(periodMs / 1000) : null,
    topic,
    transcriptAvailable: status === "finished",
  };
};

export const hearingsAt = (nowMs, { periodMs = DEFAULT_PERIOD_MS } = {}) => {
  const currentSlot = slotOf(nowMs, periodMs);
  const hearings = [];
  for (let slot = currentSlot - FINISHED_SHOWN; slot <= currentSlot + SCHEDULED_SHOWN; slot += 1) {
    hearings.push(toHearing(slot, currentSlot, periodMs));
  }
  return hearings;
};

// One hearing with its transcript, which is only filled in once it has started.
export const hearingById = (id, nowMs, { periodMs = DEFAULT_PERIOD_MS } = {}) => {
  const match = /^pv-(\d+)$/.exec(id);
  if (!match) return null;
  const slot = Number(match[1]);
  const hearing = toHearing(slot, slotOf(nowMs, periodMs), periodMs);
  const committee = COMMITTEES[slot % COMMITTEES.length];
  return {
    ...hearing,
    transcript: hearing.status === "scheduled" ? "" : transcriptFor(committee, hearing.topic),
  };
};

export const nextChangeAt = (nowMs, { periodMs = DEFAULT_PERIOD_MS } = {}) =>
  iso((slotOf(nowMs, periodMs) + 1) * periodMs);
