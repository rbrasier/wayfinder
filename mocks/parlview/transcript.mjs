// The ParlView MCP tools' logic, ported from parlviewMCP (src/transcript.ts,
// src/passages.ts, src/timecode.ts) so the mock answers the way the real server
// does: the same arguments, range rules, passages, term matching, coverage and
// stream statuses, and the same errors. It reads the mock's recordings through
// `source`, which hands back ParlView's own response shapes (vodapi, eventvideos,
// captions), and converts them the way parlviewMCP's client does.
//
// What the mock leaves out: the HLS WebVTT fallback (a mock recording's captions
// API is never short, so a chunk with no lines is simply `no_speech`), caching,
// and multi-chunk recordings (a mock recording is one chunk). Deep links point at
// the mock's own /parlview/video page instead of aph.gov.au, so they open.

export const CAVEAT =
  "Captions are typed live and contain errors, especially in names. Check the linked recording; " +
  "Hansard is the citable record. Speakers are not identified.";

const MAX_RANGE_SEC = 2 * 3600;
const DEFAULT_WINDOW_SEC = 30 * 60;
const FRAME = 1 / 25;
const PAD_MS = 1000;
const MAX_MATCH_GROUPS = 40;

export class ToolError extends Error {}

// ---------------------------------------------------------------------------
// Timecodes

const FPS = { Pal: 25 };

const frameRate = (format) => {
  const fps = FPS[format];
  if (!fps) throw new ToolError(`Unsupported TimecodeFormat "${format}" (only Pal is handled)`);
  return fps;
};

export const timecodeToSeconds = (timecode, format = "Pal") => {
  const fps = frameRate(format);
  const match = /^(\d{2}):(\d{2}):(\d{2}):(\d{2})$/.exec(timecode);
  if (!match) throw new ToolError(`Malformed timecode "${timecode}"`);
  const [hours, minutes, seconds, frames] = match.slice(1).map(Number);
  return hours * 3600 + minutes * 60 + seconds + frames / fps;
};

export const formatClock = (seconds) => {
  const whole = Math.floor(seconds + 1e-6);
  const parts = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
};

// Keeps a fractional part so paging never skips a line.
export const formatClockExact = (seconds) => {
  const whole = Math.floor(seconds + 1e-6);
  const fraction = Math.round((seconds - whole) * 100);
  return fraction > 0 ? `${formatClock(whole)}.${String(fraction).padStart(2, "0")}` : formatClock(whole);
};

const isoTimeOfDay = (iso) => {
  const match = /T(\d{2}):(\d{2}):(\d{2})/.exec(iso);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
};

const captionsOffsetMs = (targetSec, originSec) => Math.round((targetSec - originSec) * 1000);

const startTimeFor = (lineSec, recordingStartSec) => Math.floor(lineSec - recordingStartSec + 1e-6);

// "HH:MM" / "HH:MM:SS" is Canberra time of day; a number (or numeric string) is
// seconds from recording start. Returns time-of-day seconds.
export const resolveTime = (value, recordingStartSec) => {
  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(value.trim())) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) throw new ToolError(`Invalid seconds value "${value}"`);
    return recordingStartSec + seconds;
  }
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(value.trim());
  if (!match) {
    throw new ToolError(`Invalid time "${value}": use "HH:MM", "HH:MM:SS" (Canberra time) or seconds from start`);
  }
  const [hours, minutes, seconds] = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (hours > 23 || minutes > 59 || seconds >= 60) throw new ToolError(`Invalid time "${value}"`);
  return hours * 3600 + minutes * 60 + seconds;
};

// ---------------------------------------------------------------------------
// Reading ParlView, as parlviewMCP's client does

const loadRecording = (deps, videoId) => {
  if (!/^\d+$/.test(videoId)) throw new ToolError(`Invalid videoId "${videoId}": expected a numeric ParlView id`);
  const raw = deps.source.eventVideos(videoId);
  if (raw.Chunks.length === 0) throw new ToolError(`No ParlView recording with media found for id ${videoId}.`);
  const details = deps.source.details(videoId);
  const chunks = raw.Chunks.map((chunk) => ({
    chunkId: chunk.ChunkId,
    timecodeFormat: chunk.TimecodeFormat,
    somSec: timecodeToSeconds(chunk.FileSom, chunk.TimecodeFormat),
    eomSec: timecodeToSeconds(chunk.FileEom, chunk.TimecodeFormat),
  })).sort((left, right) => left.chunkId - right.chunkId);
  return {
    id: videoId,
    title: details?.parlViewTitle ?? raw.Chunks[0].EventTitle ?? `ParlView ${videoId}`,
    isLive: raw.IsLive,
    date: raw.RecordingStartDateTime.slice(0, 10),
    startSec: isoTimeOfDay(raw.RecordingStartDateTime),
    originSec: chunks[0].somSec,
    chunks,
    // The live edge as a time of day on the recording's own clock.
    liveEdgeSec: isoTimeOfDay(raw.RecordingStartDateTime) + (deps.now() - Date.parse(details.recordingFrom)) / 1000,
  };
};

const captionLines = (deps, recording, fromMs, toMs, format) =>
  deps.source
    .captions(recording.id, { fromOffset: Math.max(0, fromMs), toOffset: Math.max(0, toMs) })
    .map((row) => ({
      inSec: timecodeToSeconds(row.In, format),
      outSec: timecodeToSeconds(row.Out, format),
      text: row.Text,
    }));

const chunkEnd = (recording, index) =>
  recording.isLive && index === recording.chunks.length - 1 ? Infinity : recording.chunks[index].eomSec + FRAME;

const recordingEnd = (recording) => chunkEnd(recording, recording.chunks.length - 1);

const splitByChunk = (recording, from, to) =>
  recording.chunks.flatMap((chunk, index) => {
    const start = Math.max(from, chunk.somSec);
    const end = Math.min(to, chunkEnd(recording, index));
    return start < end ? [{ chunk, from: start, to: end }] : [];
  });

const fetchRange = (deps, recording, from, to) => {
  const lines = [];
  const coverage = [];
  for (const sub of splitByChunk(recording, from, to)) {
    const fromMs = captionsOffsetMs(sub.from, recording.originSec) - PAD_MS;
    const toMs = Number.isFinite(sub.to) ? captionsOffsetMs(sub.to, recording.originSec) + PAD_MS : 0;
    // Own each line by its In so adjacent pages never double or drop a line.
    const owned = captionLines(deps, recording, fromMs, toMs, sub.chunk.timecodeFormat).filter(
      (line) => line.inSec >= sub.from - 1e-6 && line.inSec < sub.to,
    );
    lines.push(...owned);
    coverage.push({
      chunk: sub.chunk.chunkId,
      from: formatClock(sub.from),
      to: Number.isFinite(sub.to) ? formatClock(sub.to) : "live edge",
      source: owned.length ? "captions_api" : "none",
      status: owned.length ? "ok" : "no_speech",
      lines: owned.length,
    });
  }
  return { lines, coverage };
};

// ---------------------------------------------------------------------------
// Presentation

const summarise = (lines) => (lines.length ? "ok" : "no_speech");

const STATUS_NOTE = {
  no_speech: "No caption text in this range: nobody was speaking (dead air, a break, or before proceedings began).",
  no_captions_yet: "The broadcast is live but no captions have been published since it started.",
  not_live: "This recording is not live. Use get_transcript for archived recordings.",
};

const streamInfo = (recording, from, to, status, coverage) => {
  const info = {
    id: recording.id,
    title: recording.title,
    isLive: recording.isLive,
    date: recording.date,
    recordingStart: formatClock(recording.startSec),
    chunks: recording.chunks.length,
    from: formatClock(from),
    to: Number.isFinite(to) ? formatClock(to) : "live edge",
    status,
    coverage,
  };
  if (STATUS_NOTE[status]) info.note = STATUS_NOTE[status];
  return info;
};

const SENTENCE_END = /[.?!]["'’”)]*$/;

// Caption lines → passages of about 300 characters, breaking after a sentence
// where possible and on any silence over 3 seconds.
export const buildPassages = (lines, { videoId, recordingStartSec, links }) => {
  const target = 300;
  const max = Math.round(target * 1.6);
  const min = Math.round(target / 2);
  const gap = 3;
  const out = [];
  let current = [];
  let length = 0;

  const emit = (group) => {
    if (!group.length) return;
    const inSec = group[0].inSec;
    const startTime = startTimeFor(inSec, recordingStartSec);
    const lineOffsets = [];
    let offset = 0;
    for (const line of group) {
      lineOffsets.push(offset);
      offset += line.text.length + 1;
    }
    out.push({
      timecode: formatClock(inSec),
      startTime,
      text: group.map((line) => line.text).join(" "),
      link: links.deepLink(videoId, startTime),
      inSec,
      lineOffsets,
      lineTimes: group.map((line) => line.inSec),
    });
  };
  const reset = (group) => {
    current = group;
    length = group.reduce((total, line) => total + line.text.length + 1, 0) - (group.length ? 1 : 0);
  };
  const lastSentenceBreak = () => {
    for (let index = current.length - 1, size = length; index >= 0; size -= current[index].text.length + 1, index -= 1) {
      if (size < min) return -1;
      if (SENTENCE_END.test(current[index].text)) return index;
    }
    return -1;
  };

  for (const raw of lines) {
    const text = raw.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const previous = current.at(-1);
    if (previous && raw.inSec - previous.outSec > gap) {
      emit(current);
      reset([]);
    } else if (previous && length + 1 + text.length > max) {
      const breakAt = lastSentenceBreak();
      emit(breakAt >= 0 ? current.slice(0, breakAt + 1) : current);
      reset(breakAt >= 0 ? current.slice(breakAt + 1) : []);
    }
    length += (current.length ? 1 : 0) + text.length;
    current.push({ ...raw, text });
    if (length >= target && SENTENCE_END.test(text)) {
      emit(current);
      reset([]);
    }
  }
  emit(current);
  return out;
};

const publicPassage = (passage) => ({
  timecode: passage.timecode,
  startTime: passage.startTime,
  text: passage.text,
  link: passage.link,
});

const passagesFor = (deps, recording, lines) =>
  buildPassages(lines, { videoId: recording.id, recordingStartSec: recording.startSec, links: deps.links });

// ---------------------------------------------------------------------------
// Term matching: case-insensitive, whole-word, elastic separators, camelCase
// humps split ("AirTrunk" → Air, Trunk), runs of capitals kept whole ("ANAO").

export const termParts = (term) => term.match(/\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{N}+/gu) ?? [];

const SEPARATOR = "[\\s\\-‐‑–—_/]*";
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const compileTerm = (term) => {
  const parts = termParts(term);
  if (parts.length === 0) throw new ToolError(`Search term "${term}" has no letters or digits`);
  return new RegExp(`(?<![\\p{L}\\p{N}])${parts.map(escapeRegex).join(SEPARATOR)}(?![\\p{L}\\p{N}])`, "giu");
};

const upperBound = (values, target) => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
};

// The passages are searched as one stream, so a phrase split across caption
// lines or passages is still found.
const findHits = (passages, terms) => {
  const starts = [];
  let joined = "";
  for (const passage of passages) {
    if (joined) joined += " ";
    starts.push(joined.length);
    joined += passage.text;
  }
  const hits = [];
  for (const term of terms) {
    for (const match of joined.matchAll(compileTerm(term))) {
      const passageIndex = upperBound(starts, match.index) - 1;
      const passage = passages[passageIndex];
      const lineIndex = Math.max(0, upperBound(passage.lineOffsets, match.index - starts[passageIndex]) - 1);
      hits.push({ term, passage: passageIndex, atSec: passage.lineTimes[lineIndex] });
    }
  }
  return hits.sort((left, right) => left.atSec - right.atSec || left.passage - right.passage);
};

// ---------------------------------------------------------------------------
// Tools

const broadcast = (deps, video) => ({
  id: video.parlViewId,
  title: video.parlViewTitle,
  committee: video.eventTitle ?? null,
  group: [video.eventGroup, video.eventSubGroup].map((part) => part?.trim()).filter(Boolean).join(" / "),
  pageUrl: deps.links.pageUrl(video.parlViewId),
});

export const listLiveBroadcasts = (deps) => {
  const live = deps.source
    .search(0, 40)
    .videos.filter((video) => video.isLive)
    .map((video) => ({ ...broadcast(deps, video), startedAt: video.recordingFrom }));
  return live.length ? { broadcasts: live } : { broadcasts: [], note: "Nothing is broadcasting on ParlView right now." };
};

export const searchBroadcasts = (deps, { query, limit }) => {
  const cap = Math.min(Math.max(limit ?? 20, 1), 40);
  const words = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const { videos } = deps.source.search(0, 40);
  const matches = videos
    .filter((video) => {
      const haystack = [video.parlViewTitle, video.eventTitle, video.eventGroup, video.eventSubGroup, video.recordingFrom]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((word) => haystack.includes(word));
    })
    .slice(0, cap);
  const recordings = matches.map((video) => {
    const recording = loadRecording(deps, video.parlViewId);
    return {
      ...broadcast(deps, video),
      isLive: video.isLive,
      recordedFrom: video.recordingFrom,
      recordedTo: video.recordingTo ?? null,
      hasCaptions: video.hasCaptions ?? null,
      chunks: recording.chunks.map((chunk, index) => ({
        chunk: chunk.chunkId,
        from: formatClock(chunk.somSec),
        to: Number.isFinite(chunkEnd(recording, index)) ? formatClock(chunk.eomSec) : "live",
      })),
    };
  });
  const result = { recordings };
  if (words.length && recordings.length < cap) result.note = `Searched the ${videos.length} most recent recordings.`;
  return result;
};

// The first caption line, probing 30-minute windows from the start.
const firstSpeech = (deps, recording) => {
  const end = recordingEnd(recording);
  for (let from = recording.originSec; from < end; from += DEFAULT_WINDOW_SEC) {
    for (const sub of splitByChunk(recording, from, Math.min(end, from + DEFAULT_WINDOW_SEC))) {
      const fromMs = captionsOffsetMs(sub.from, recording.originSec);
      const toMs = captionsOffsetMs(sub.to, recording.originSec);
      const first = captionLines(deps, recording, fromMs, toMs, sub.chunk.timecodeFormat).find(
        (line) => line.inSec >= sub.from,
      );
      if (first) return first.inSec;
    }
  }
  return recording.originSec;
};

const transcriptRange = (deps, recording, args, end) => {
  const clampFrom = (time) => Math.max(recording.originSec, time);
  if (args.from === undefined && args.to === undefined) {
    if (recording.isLive) return { from: clampFrom(end - DEFAULT_WINDOW_SEC), to: Infinity };
    const from = firstSpeech(deps, recording);
    return { from, to: from + DEFAULT_WINDOW_SEC };
  }
  if (args.from !== undefined) {
    const from = clampFrom(resolveTime(args.from, recording.startSec));
    return { from, to: args.to !== undefined ? resolveTime(args.to, recording.startSec) : from + MAX_RANGE_SEC };
  }
  const to = resolveTime(args.to, recording.startSec);
  return { from: clampFrom(to - DEFAULT_WINDOW_SEC), to };
};

export const getTranscript = (deps, args) => {
  const recording = loadRecording(deps, args.videoId);
  const maxPassages = Math.min(Math.max(args.maxPassages ?? 300, 1), 1000);
  const end = recording.isLive ? recording.liveEdgeSec : recordingEnd(recording);
  let { from, to } = transcriptRange(deps, recording, args, end);
  let truncated = false;
  let nextFrom = null;
  if (Math.min(to, end) - from > MAX_RANGE_SEC) {
    to = from + MAX_RANGE_SEC;
    truncated = true;
    nextFrom = formatClockExact(to);
  }
  if (to >= end) to = recording.isLive ? Infinity : end;
  if (from >= Math.min(to, end)) {
    throw new ToolError(
      `Empty range starting ${formatClock(from)}. Recording runs ` +
        `${formatClock(recording.originSec)}–${recording.isLive ? "now (live)" : formatClock(end)} Canberra time.`,
    );
  }

  const range = fetchRange(deps, recording, from, to);
  let passages = passagesFor(deps, recording, range.lines);
  if (passages.length > maxPassages) {
    truncated = true;
    nextFrom = formatClockExact(passages[maxPassages].inSec);
    passages = passages.slice(0, maxPassages);
  }
  return {
    stream: streamInfo(recording, from, to, summarise(range.lines), range.coverage),
    passages: passages.map(publicPassage),
    truncated,
    nextFrom,
    caveat: CAVEAT,
  };
};

export const getRecent = (deps, args) => {
  const minutes = Math.min(Math.max(args.minutes ?? 60, 1), 120);
  const recording = loadRecording(deps, args.videoId);
  if (!recording.isLive) {
    return {
      stream: streamInfo(recording, recording.originSec, recordingEnd(recording), "not_live", []),
      passages: [],
      caveat: CAVEAT,
    };
  }
  const from = Math.max(recording.originSec, recording.liveEdgeSec - minutes * 60);
  const range = fetchRange(deps, recording, from, Infinity);
  let status = summarise(range.lines);
  if (!range.lines.length && from === recording.originSec) status = "no_captions_yet";
  const last = range.lines.at(-1);
  return {
    stream: {
      ...streamInfo(recording, from, Infinity, status, range.coverage),
      lastCaption: last ? formatClock(last.inSec) : null,
    },
    passages: passagesFor(deps, recording, range.lines).map(publicPassage),
    truncated: false,
    caveat: CAVEAT,
  };
};

const groupHits = (hits, passageCount, context) => {
  const groups = [];
  for (const hit of [...hits].sort((left, right) => left.passage - right.passage)) {
    const low = Math.max(0, hit.passage - context);
    const high = Math.min(passageCount - 1, hit.passage + context);
    const last = groups.at(-1);
    if (last && low <= last.high + 1) {
      last.high = Math.max(last.high, high);
      last.hits.push(hit);
      continue;
    }
    groups.push({ low, high, hits: [hit] });
  }
  return groups;
};

export const searchCaptions = (deps, args) => {
  const terms = [...new Set(args.terms.map((term) => term.trim()).filter(Boolean))];
  if (!terms.length) throw new ToolError("Provide at least one search term.");
  const context = Math.min(Math.max(args.contextPassages ?? 1, 0), 5);
  const recording = loadRecording(deps, args.videoId);
  const end = recording.isLive ? Infinity : recordingEnd(recording);
  const from =
    args.from !== undefined ? Math.max(recording.originSec, resolveTime(args.from, recording.startSec)) : recording.originSec;
  const to = args.to !== undefined ? Math.min(end, resolveTime(args.to, recording.startSec)) : end;
  if (from >= to) throw new ToolError("Empty search range.");

  const range = fetchRange(deps, recording, from, to);
  const passages = passagesFor(deps, recording, range.lines);
  const hits = findHits(passages, terms);
  const groups = groupHits(hits, passages.length, context);
  return {
    stream: streamInfo(recording, from, to, summarise(range.lines), range.coverage),
    terms: Object.fromEntries(terms.map((term) => [term, hits.filter((hit) => hit.term === term).length])),
    totalHits: hits.length,
    matches: groups.slice(0, MAX_MATCH_GROUPS).map((group) => ({
      hits: group.hits.map((hit) => {
        const startTime = startTimeFor(hit.atSec, recording.startSec);
        return { term: hit.term, timecode: formatClock(hit.atSec), startTime, link: deps.links.deepLink(recording.id, startTime) };
      }),
      passages: passages.slice(group.low, group.high + 1).map(publicPassage),
    })),
    truncated: groups.length > MAX_MATCH_GROUPS,
    caveat: CAVEAT,
  };
};

export const deepLinkTool = (deps, args) => {
  const recording = loadRecording(deps, args.videoId);
  const time = resolveTime(args.at, recording.startSec);
  const end = recordingEnd(recording);
  if (time < recording.startSec || time > end) {
    throw new ToolError(
      `${formatClock(time)} is outside the recording (${formatClock(recording.startSec)}–${recording.isLive ? "live" : formatClock(end)}).`,
    );
  }
  const startTime = startTimeFor(time, recording.startSec);
  return { url: deps.links.deepLink(recording.id, startTime), timecode: formatClock(time), startTime };
};
