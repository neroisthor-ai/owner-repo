// The cut as an OpenTimelineIO timeline. Clips point at content-hashed renders,
// so an unchanged shot keeps its media across versions.

import type { Compiled } from "../scene/compile.ts";

const rt = (value: number, rate: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate, value: Math.round(value * rate) });
const range = (start: number, dur: number, rate: number) => ({ OTIO_SCHEMA: "TimeRange.1", start_time: rt(start, rate), duration: rt(dur, rate) });

export function toOtio(c: Compiled, name: string) {
  const fps = c.fps;
  const video = c.shots.map((s) => ({
    OTIO_SCHEMA: "Clip.2",
    name: s.id,
    source_range: range(s.trimHead, s.cutDur, fps),
    media_references: {
      DEFAULT_MEDIA: {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: `renders/${s.id}_${s.hash}.mov`,
        available_range: range(0, s.dur + s.hold, fps),
        metadata: {},
      },
    },
    active_media_reference_key: "DEFAULT_MEDIA",
    effects: [],
    markers: [],
    enabled: true,
    metadata: { crew: { hash: s.hash, label: s.label, lens: s.lens, move: s.move, trim: [s.trimHead, s.trimTail], hold: s.hold } },
  }));
  const dialogue: unknown[] = [];
  let cursor = 0;
  for (const e of c.audio.filter((a) => a.type === "say")) {
    if (e.t > cursor + 1e-3) dialogue.push({ OTIO_SCHEMA: "Gap.1", name: "", source_range: range(0, e.t - cursor, fps), effects: [], markers: [], enabled: true, metadata: {} });
    dialogue.push({
      OTIO_SCHEMA: "Clip.2", name: `${e.char}: ${e.text}`, source_range: range(0, e.dur, fps),
      media_references: { DEFAULT_MEDIA: { OTIO_SCHEMA: "MissingReference.1", name: "", available_range: null, metadata: {} } },
      active_media_reference_key: "DEFAULT_MEDIA", effects: [], markers: [], enabled: true,
      metadata: { crew: { shot: e.shot, addr: e.addr, char: e.char, voice: e.voice } },
    });
    cursor = Math.max(cursor, e.t + e.dur);
  }
  const track = (n: string, kind: string, children: unknown[]) => ({ OTIO_SCHEMA: "Track.1", name: n, kind, source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children });
  return {
    OTIO_SCHEMA: "Timeline.1",
    name,
    global_start_time: null,
    metadata: { crew: { duration: c.duration, fps } },
    tracks: { OTIO_SCHEMA: "Stack.1", name: "tracks", source_range: null, effects: [], markers: [], enabled: true, metadata: {}, children: [track("V1", "Video", video), track("Dialogue", "Audio", dialogue)] },
  };
}
