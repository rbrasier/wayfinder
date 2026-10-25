// The mock's ParlView recordings, worked out from the clock rather than stored,
// so every check (and a restarted mock) agrees on what is live. Time is cut into
// slots of one period: the recording for the current slot is live, earlier ones
// have finished and later ones are scheduled. Each rollover finishes one hearing
// and starts the next, which is the change an Event Watch listens for
// (`isLive` going from true to false).
//
// Everything a client sees is in ParlView's own shapes, copied from the
// responses parlviewMCP reads (its SPEC §3 and test/fixtures):
//   - vodapi search and details (`searchResults.videos[]`, `videoDetails`);
//   - vod eventvideos (one recording's chunks, PAL time-of-day timecodes);
//   - the vod captions API (caption lines of about 30 characters, no speakers).
// Times are Canberra time, as ParlView's are. A mock recording is one period
// long, so it always fits in one chunk.

export const DEFAULT_PERIOD_MS = 5 * 60 * 1000;

export const FPS = 25;
export const TIMECODE_FORMAT = "Pal";

const FINISHED_LISTED = 8;
// How far back ids still resolve: a week of 5-minute slots. An older id gets
// ParlView's no-media answer, as a recording that never existed does.
const RETAINED_SLOTS = 7 * 24 * 12;
const CANBERRA = "Australia/Sydney";

const COMMITTEES = [
  { eventTitle: "Senate Finance and Public Administration Legislation Committee", portfolio: "Finance" },
  { eventTitle: "Senate Economics Legislation Committee", portfolio: "Treasury" },
  { eventTitle: "Senate Legal and Constitutional Affairs Legislation Committee", portfolio: "Home Affairs" },
  { eventTitle: "Senate Community Affairs Legislation Committee", portfolio: "Health and Aged Care" },
  { eventTitle: "Senate Foreign Affairs, Defence and Trade Legislation Committee", portfolio: "Defence" },
  {
    eventTitle: "Senate Environment and Communications Legislation Committee",
    portfolio: "Climate Change, Energy, the Environment and Water",
  },
];

const TOPICS = [
  "program funding and underspends",
  "staffing levels and contractor use",
  "the timing of a delayed report",
  "procurement of a major ICT system",
  "responses to questions on notice",
];

// ---------------------------------------------------------------------------
// Canberra time

const canberraParts = (ms) => {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: CANBERRA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const seconds = get("hour") * 3600 + get("minute") * 60 + get("second");
  const offsetMinutes = Math.round(
    (Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) -
      Math.floor(ms / 1000) * 1000) /
      60_000,
  );
  return { year: get("year"), month: get("month"), day: get("day"), seconds, offsetMinutes };
};

const pad = (value, width = 2) => String(value).padStart(width, "0");

const clockOf = (seconds) => {
  const whole = Math.floor(seconds);
  return `${pad(Math.floor(whole / 3600))}:${pad(Math.floor((whole % 3600) / 60))}:${pad(whole % 60)}`;
};

const offsetOf = (minutes) => `${minutes < 0 ? "-" : "+"}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;

// `2026-09-22T10:15:00+10:00` (vodapi) or `2026-09-22T10:15:00` (eventvideos).
const localIso = (ms, withOffset) => {
  const parts = canberraParts(ms);
  const date = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  return `${date}T${clockOf(parts.seconds)}${withOffset ? offsetOf(parts.offsetMinutes) : ""}`;
};

// A PAL time-of-day timecode, HH:MM:SS:FF, from a frame count since midnight.
export const timecodeOf = (frames) => `${clockOf(Math.floor(frames / FPS))}:${pad(frames % FPS)}`;

// ---------------------------------------------------------------------------
// Recordings

const slotOf = (nowMs, periodMs) => Math.floor(nowMs / periodMs);

const statusOf = (slot, currentSlot) => {
  if (slot < currentSlot) return "finished";
  if (slot === currentSlot) return "live";
  return "scheduled";
};

// The id is the slot number: numeric, like a real ParlView id, and the same on every check.
const recordingFor = (slot, currentSlot, periodMs) => {
  const committee = COMMITTEES[slot % COMMITTEES.length];
  const startMs = slot * periodMs;
  const start = canberraParts(startMs);
  return {
    id: String(slot),
    slot,
    status: statusOf(slot, currentSlot),
    eventTitle: committee.eventTitle,
    portfolio: committee.portfolio,
    startMs,
    endMs: startMs + periodMs,
    date: `${start.year}-${pad(start.month)}-${pad(start.day)}`,
    // A recording that crosses midnight keeps counting past 24:00, so its times stay in order.
    startFrame: start.seconds * FPS,
    endFrame: start.seconds * FPS + Math.round((periodMs / 1000) * FPS),
  };
};

export const recordingById = (id, nowMs, { periodMs = DEFAULT_PERIOD_MS } = {}) => {
  if (!/^\d+$/.test(String(id))) return null;
  const currentSlot = slotOf(nowMs, periodMs);
  const slot = Number(id);
  if (slot <= currentSlot - RETAINED_SLOTS) return null;
  return recordingFor(slot, currentSlot, periodMs);
};

// What vodapi lists: the live recording and the most recent finished ones,
// newest first. A scheduled recording is not on ParlView yet.
export const listedRecordings = (nowMs, { periodMs = DEFAULT_PERIOD_MS } = {}) => {
  const currentSlot = slotOf(nowMs, periodMs);
  const recordings = [];
  for (let slot = currentSlot; slot > currentSlot - 1 - FINISHED_LISTED; slot -= 1) {
    recordings.push(recordingFor(slot, currentSlot, periodMs));
  }
  return recordings;
};

// vodapi's search page: `{ searchResults: { totalItems, videos } }`, newest first.
export const searchResults = (nowMs, { periodMs = DEFAULT_PERIOD_MS, page = 0, pageSize = 40 } = {}) => {
  const videos = listedRecordings(nowMs, { periodMs }).map(vodapiVideo);
  return {
    searchResults: { totalItems: videos.length, videos: videos.slice(page * pageSize, (page + 1) * pageSize) },
  };
};

export const nextChangeAt = (nowMs, { periodMs = DEFAULT_PERIOD_MS } = {}) =>
  new Date((slotOf(nowMs, periodMs) + 1) * periodMs).toISOString();

// ---------------------------------------------------------------------------
// ParlView shapes

export const vodapiVideo = (recording) => ({
  parlViewId: recording.id,
  parlViewTitle: `${recording.eventTitle} - Canberra, ACT`,
  eventTitle: recording.eventTitle,
  eventGroup: "Committees",
  eventSubGroup: "Senate",
  isLive: recording.status === "live",
  hasCaptions: true,
  recordingFrom: localIso(recording.startMs, true),
  recordingTo: recording.status === "finished" ? localIso(recording.endMs, true) : null,
});

// ParlView's answer for an id it has no media for (unknown, or not started).
const NO_MEDIA = { RecordingStartDateTime: "0001-01-01T00:00:00", RecordingEndDateTime: null, IsLive: false, Chunks: [] };

export const eventVideos = (recording, nowMs) => {
  if (!recording || recording.status === "scheduled") return NO_MEDIA;
  const isLive = recording.status === "live";
  const lastFrame = isLive ? Math.min(recording.endFrame, frameAt(recording, nowMs)) : recording.endFrame;
  const [year, month, day] = recording.date.split("-");
  const lines = captionScript(recording);
  return {
    AspectRatio: "16:9",
    RecordingStartDateTime: localIso(recording.startMs, false),
    RecordingEndDateTime: isLive ? null : localIso(recording.endMs, false),
    IsLive: isLive,
    MediaSom: timecodeOf(lines[0]?.inFrame ?? recording.startFrame),
    Chunks: [
      {
        EventId: recording.id,
        EventTitle: recording.eventTitle,
        Title: `${day}/${month}/${year}`,
        ProxyUrl: `https://aphbroadcasting-prod.z01.azurefd.net/vod-storage/access/${year}/${recording.id}/1/${recording.id}_02_01.m3u8`,
        TimecodeFormat: TIMECODE_FORMAT,
        FileSom: timecodeOf(recording.startFrame),
        FileSomMs: Math.round((recording.startFrame / FPS) * 1000),
        FileEom: timecodeOf(lastFrame - 1),
        FileEomMs: Math.round(((lastFrame - 1) / FPS) * 1000),
        Id: recording.slot * 10 + 1,
        ChunkId: 1,
      },
    ],
  };
};

const frameAt = (recording, nowMs) => recording.startFrame + Math.floor(((nowMs - recording.startMs) / 1000) * FPS);

// ---------------------------------------------------------------------------
// Captions

const MAX_LINE_CHARS = 32;
const LEAD_IN_FRAMES = 8 * FPS;
const EXCHANGE_GAP_FRAMES = 6 * FPS;

// Live captions carry no speaker labels, so neither does this script.
const openingFor = (recording) => [
  `I declare open this hearing of the ${recording.eventTitle}.`,
  `The committee is continuing its examination of budget estimates for the ${recording.portfolio} portfolio.`,
];

const ROUND_LENGTH = 6;
const LEADS = ["I'd like to start with", "Turning now to", "Can I ask about"];

// One round of questions on a topic; each round moves to the next topic.
const roundFor = (recording, round) => {
  const topic = TOPICS[(recording.slot + round) % TOPICS.length];
  return [
    `${LEADS[round % LEADS.length]} ${topic}. Can the department explain where things stand?`,
    "Thank you, Senator. I can give you an update now and take the detail on notice.",
    `Has the minister been briefed on ${topic}?`,
    "The minister's office was briefed last month. I'll confirm the date on notice.",
    "And what did the ANAO find when it looked at this?",
    "The ANAO report made four recommendations and the department has accepted all of them.",
  ];
};

const CLOSING = ["That concludes today's hearing. The committee is adjourned."];

const fragmentsOf = (sentence) => {
  const fragments = [];
  let current = "";
  for (const word of sentence.split(" ")) {
    if (current && current.length + 1 + word.length > MAX_LINE_CHARS) {
      fragments.push(current);
      current = word;
      continue;
    }
    current = current ? `${current} ${word}` : word;
  }
  if (current) fragments.push(current);
  return fragments;
};

// About 12 characters a second, as live captioning runs.
const framesFor = (text) => Math.max(Math.round(1.2 * FPS), Math.round((text.length / 12) * FPS));

// Every caption line of a recording, start to finish: an opening, rounds of
// questions and answers until the time runs out, and a closing. Lines are in frames since
// midnight, so they convert to PAL timecodes exactly.
export const captionScript = (recording) => {
  const closing = CLOSING.flatMap(fragmentsOf);
  const closingFrames = closing.reduce((total, text) => total + framesFor(text), 0);
  const closeBy = recording.endFrame - Math.round(2 * FPS) - closingFrames;
  const lines = [];
  let frame = recording.startFrame + LEAD_IN_FRAMES;
  const say = (text) => {
    const length = framesFor(text);
    lines.push({ inFrame: frame, outFrame: frame + length, text });
    frame += length;
  };

  for (const text of openingFor(recording).flatMap(fragmentsOf)) {
    if (frame + framesFor(text) > closeBy) break;
    say(text);
  }
  for (let index = 0; ; index += 1) {
    const round = roundFor(recording, Math.floor(index / ROUND_LENGTH));
    const fragments = fragmentsOf(round[index % ROUND_LENGTH]);
    const length = fragments.reduce((total, text) => total + framesFor(text), 0);
    if (frame + EXCHANGE_GAP_FRAMES + length > closeBy) break;
    frame += EXCHANGE_GAP_FRAMES;
    fragments.forEach(say);
  }
  frame = Math.max(frame, closeBy);
  for (const text of closing) {
    if (frame + framesFor(text) > recording.endFrame) break;
    say(text);
  }
  return lines;
};

const captionRow = (line) => ({
  In: timecodeOf(line.inFrame),
  Out: timecodeOf(line.outFrame),
  AbsoluteSomTimecode: timecodeOf(line.inFrame),
  AbsoluteEomTimecode: timecodeOf(line.outFrame),
  Text: line.text,
});

// The captions API: lines whose In falls in [fromOffset, toOffset), in ms from
// the first chunk's FileSom; a toOffset of 0 is open-ended. A live recording
// has only the lines already spoken.
export const captionsBetween = (recording, nowMs, { fromOffset = 0, toOffset = 0 } = {}) => {
  if (!recording || recording.status === "scheduled") return [];
  const spokenBy = recording.status === "live" ? frameAt(recording, nowMs) : Infinity;
  const offsetMs = (frame) => ((frame - recording.startFrame) / FPS) * 1000;
  return captionScript(recording)
    .filter((line) => line.outFrame <= spokenBy)
    .filter((line) => offsetMs(line.inFrame) >= fromOffset && (!toOffset || offsetMs(line.inFrame) < toOffset))
    .map(captionRow);
};

// ParlView as a client sees it, at the mock clock's "now": what each endpoint
// the real server reads would answer.
export const createParlviewSource = ({ clock, periodMs = DEFAULT_PERIOD_MS }) => {
  const recording = (id) => recordingById(id, clock.now(), { periodMs });
  return {
    search: (page, pageSize) => {
      const { searchResults: results } = searchResults(clock.now(), { periodMs, page, pageSize });
      return { total: results.totalItems, videos: results.videos };
    },
    details: (id) => {
      const found = recording(id);
      return found && found.status !== "scheduled" ? vodapiVideo(found) : null;
    },
    eventVideos: (id) => eventVideos(recording(id), clock.now()),
    captions: (id, offsets) => captionsBetween(recording(id), clock.now(), offsets),
  };
};
