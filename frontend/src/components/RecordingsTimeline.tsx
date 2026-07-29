import { useMemo, useRef, type PointerEvent } from "react";
import type { CcamEvent, RecordingSegment } from "../lib/types";

const PX_PER_MIN = 4;
const DAY_MINUTES = 24 * 60;
const TRACK_HEIGHT = 96;
const NOMINAL_SEGMENT_MIN = 15; // matches SEGMENT_SECONDS in continuousRecorder.ts
// Segment rotation isn't frame-perfect (ffmpeg cuts at the next keyframe,
// not exactly on the second), so consecutive segments can touch a few
// seconds late without that being a real recording gap. Anything wider than
// this is treated as an actual break in coverage.
const GAP_TOLERANCE_MIN = 1;

const TYPE_DOT_CLASS: Record<CcamEvent["type"], string> = {
  person: "bg-accent",
  vehicle: "bg-warning",
  pet: "bg-success",
  motion: "bg-muted",
};

/**
 * A horizontally scrollable 24h timeline (not a fixed-width bar squeezed
 * into the container) -- segments and events are positioned by real time,
 * dragging/clicking anywhere seeks playback to that instant, jumping across
 * segment boundaries automatically.
 */
export function RecordingsTimeline({
  date,
  segments,
  events,
  currentTimeMs,
  onSeek,
}: {
  date: string;
  segments: RecordingSegment[];
  events: CcamEvent[];
  currentTimeMs: number | null;
  onSeek: (atMs: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dayStartMs = useMemo(() => new Date(`${date}T00:00:00`).getTime(), [date]);

  function minutesOf(ms: number) {
    return (ms - dayStartMs) / 60000;
  }

  // Coalesce back-to-back segments into single continuous coverage ranges so
  // the track reads as one recording with real breaks, not as a row of
  // separate clips lined up next to each other -- a true gap (recorder
  // down, camera offline) still shows as an actual gap in the bar.
  const coverageRanges = useMemo(() => {
    const ranges: { startMin: number; endMin: number }[] = [];
    for (const seg of segments) {
      const startMin = Math.max(0, minutesOf(new Date(seg.startedAt).getTime()));
      const endMin = Math.min(DAY_MINUTES, startMin + NOMINAL_SEGMENT_MIN);
      const last = ranges[ranges.length - 1];
      if (last && startMin <= last.endMin + GAP_TOLERANCE_MIN) {
        last.endMin = Math.max(last.endMin, endMin);
      } else {
        ranges.push({ startMin, endMin });
      }
    }
    return ranges;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, dayStartMs]);

  function seekFromClientX(clientX: number) {
    const el = trackRef.current;
    if (!el) return;
    const x = clientX - el.getBoundingClientRect().left;
    const minutes = Math.min(DAY_MINUTES, Math.max(0, x / PX_PER_MIN));
    onSeek(dayStartMs + minutes * 60000);
  }

  function handlePointerDown(e: PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  }

  function handlePointerMove(e: PointerEvent) {
    if (e.buttons !== 1) return;
    seekFromClientX(e.clientX);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="overflow-x-auto">
        <div
          ref={trackRef}
          className="relative cursor-pointer select-none"
          style={{ width: DAY_MINUTES * PX_PER_MIN, height: TRACK_HEIGHT }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
        >
          {/* Hour gridlines */}
          {Array.from({ length: 25 }, (_, h) => (
            <div
              key={h}
              className="absolute top-0 bottom-0 border-l border-border/60"
              style={{ left: h * 60 * PX_PER_MIN }}
            >
              {h % 2 === 0 && (
                <span className="absolute top-0.5 left-1 text-[10px] text-muted">
                  {String(h).padStart(2, "0")}:00
                </span>
              )}
            </div>
          ))}

          {/* Continuous recording coverage */}
          <div className="absolute inset-x-0" style={{ top: 20, height: 36 }}>
            {coverageRanges.map((range) => (
              <div
                key={range.startMin}
                className="absolute top-0 h-full rounded bg-accent/60"
                style={{
                  left: range.startMin * PX_PER_MIN,
                  width: (range.endMin - range.startMin) * PX_PER_MIN,
                }}
              />
            ))}
          </div>

          {/* Events */}
          <div className="absolute inset-x-0" style={{ top: 62, height: 10 }}>
            {events.map((ev) => (
              <div
                key={ev.id}
                className={`absolute top-0 h-full w-1 rounded-full ${TYPE_DOT_CLASS[ev.type]}`}
                style={{ left: minutesOf(new Date(ev.startedAt).getTime()) * PX_PER_MIN }}
                title={`${ev.type} @ ${new Date(ev.startedAt).toLocaleTimeString("fr-CA")}`}
              />
            ))}
          </div>

          {/* Playhead */}
          {currentTimeMs !== null && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-danger"
              style={{ left: minutesOf(currentTimeMs) * PX_PER_MIN }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
