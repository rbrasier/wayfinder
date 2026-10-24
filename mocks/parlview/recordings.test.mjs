import { describe, expect, it } from "vitest";
import {
  captionScript,
  captionsBetween,
  eventVideos,
  listedRecordings,
  recordingById,
  searchResults,
  vodapiVideo,
} from "./recordings.mjs";

const PERIOD = 5 * 60 * 1000;
const SLOT = 5_976_000;
const at = (slot, offset = 0) => slot * PERIOD + offset;
const PAL_TIMECODE = /^\d{2}:\d{2}:\d{2}:\d{2}$/;

describe("listedRecordings", () => {
  it("lists the live recording first, then finished ones, newest first, and nothing scheduled", () => {
    const recordings = listedRecordings(at(SLOT, 1_000), { periodMs: PERIOD });

    expect(recordings[0]).toMatchObject({ id: String(SLOT), status: "live" });
    expect(recordings.slice(1).every((recording) => recording.status === "finished")).toBe(true);
    expect(recordings.map((recording) => Number(recording.id))).toEqual(
      [...recordings].map((_, index) => SLOT - index),
    );
  });

  it("finishes the live recording when the period rolls over", () => {
    const after = listedRecordings(at(SLOT + 1), { periodMs: PERIOD });

    expect(after.find((recording) => recording.id === String(SLOT)).status).toBe("finished");
    expect(after[0]).toMatchObject({ id: String(SLOT + 1), status: "live" });
  });
});

describe("vodapiVideo", () => {
  it("has vodapi's fields, with Canberra times carrying their offset", () => {
    const video = vodapiVideo(recordingById(String(SLOT - 1), at(SLOT, 1_000), { periodMs: PERIOD }));

    expect(video).toMatchObject({
      parlViewId: String(SLOT - 1),
      eventGroup: "Committees",
      eventSubGroup: "Senate",
      isLive: false,
      hasCaptions: true,
    });
    expect(video.parlViewTitle).toBe(`${video.eventTitle} - Canberra, ACT`);
    expect(video.recordingFrom).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+1[01]:00$/);
    expect(Date.parse(video.recordingTo) - Date.parse(video.recordingFrom)).toBe(PERIOD);
  });

  it("has no recordingTo while live", () => {
    expect(vodapiVideo(recordingById(String(SLOT), at(SLOT, 1_000), { periodMs: PERIOD })).recordingTo).toBeNull();
  });

  it("flips isLive from true to false at the rollover, the change an Event Watch fires on", () => {
    const before = searchResults(at(SLOT, PERIOD - 1), { periodMs: PERIOD }).searchResults.videos;
    const after = searchResults(at(SLOT + 1), { periodMs: PERIOD }).searchResults.videos;

    expect(before.find((video) => video.parlViewId === String(SLOT)).isLive).toBe(true);
    expect(after.find((video) => video.parlViewId === String(SLOT)).isLive).toBe(false);
  });
});

describe("recordingById", () => {
  it("knows nothing of ids that are not numeric or are older than a week", () => {
    expect(recordingById("pv-1", at(SLOT), { periodMs: PERIOD })).toBeNull();
    expect(recordingById("12", at(SLOT), { periodMs: PERIOD })).toBeNull();
  });
});

describe("eventVideos", () => {
  it("describes one Pal chunk running the whole of a finished recording", () => {
    const recording = recordingById(String(SLOT - 1), at(SLOT, 1_000), { periodMs: PERIOD });
    const raw = eventVideos(recording, at(SLOT, 1_000));

    expect(raw.IsLive).toBe(false);
    expect(raw.RecordingStartDateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(raw.Chunks).toHaveLength(1);
    expect(raw.Chunks[0]).toMatchObject({ ChunkId: 1, EventId: String(SLOT - 1), TimecodeFormat: "Pal" });
    expect(raw.Chunks[0].FileSom).toMatch(PAL_TIMECODE);
    expect(raw.Chunks[0].FileEomMs - raw.Chunks[0].FileSomMs).toBe(PERIOD - 40);
  });

  it("answers as ParlView does for an id it has no media for", () => {
    expect(eventVideos(null, at(SLOT))).toMatchObject({ RecordingStartDateTime: "0001-01-01T00:00:00", Chunks: [] });
    const scheduled = recordingById(String(SLOT + 1), at(SLOT), { periodMs: PERIOD });
    expect(eventVideos(scheduled, at(SLOT)).Chunks).toEqual([]);
  });
});

describe("captions", () => {
  const finished = () => recordingById(String(SLOT - 1), at(SLOT, 1_000), { periodMs: PERIOD });

  it("are short lines inside the recording, in order, opening and closing the hearing", () => {
    const recording = finished();
    const lines = captionScript(recording);

    expect(lines.length).toBeGreaterThan(40);
    expect(lines.every((line) => line.text.length <= 32)).toBe(true);
    expect(lines[0].inFrame).toBeGreaterThan(recording.startFrame);
    expect(lines.at(-1).outFrame).toBeLessThanOrEqual(recording.endFrame);
    expect(lines.every((line, index) => index === 0 || line.inFrame >= lines[index - 1].outFrame)).toBe(true);
    expect(lines[0].text).toBe("I declare open this hearing of");
    expect(lines.at(-1).text).toBe("The committee is adjourned.");
  });

  it("come back in the captions API's row shape, filtered by offset from FileSom", () => {
    const recording = finished();
    const all = captionsBetween(recording, at(SLOT, 1_000));
    const firstMinute = captionsBetween(recording, at(SLOT, 1_000), { fromOffset: 0, toOffset: 60_000 });

    expect(Object.keys(all[0])).toEqual(["In", "Out", "AbsoluteSomTimecode", "AbsoluteEomTimecode", "Text"]);
    expect(all[0].In).toMatch(PAL_TIMECODE);
    expect(firstMinute.length).toBeGreaterThan(0);
    expect(firstMinute.length).toBeLessThan(all.length);
  });

  it("of a live recording hold only what has been said so far", () => {
    const live = (offset) => recordingById(String(SLOT), at(SLOT, offset), { periodMs: PERIOD });

    expect(captionsBetween(live(1_000), at(SLOT, 1_000))).toEqual([]);
    const early = captionsBetween(live(60_000), at(SLOT, 60_000)).length;
    const later = captionsBetween(live(120_000), at(SLOT, 120_000)).length;
    expect(early).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(early);
  });
});
