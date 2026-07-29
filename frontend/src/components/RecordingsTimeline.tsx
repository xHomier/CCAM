import { useMemo, useRef, type PointerEvent } from "react";
import type { CcamEvent, RecordingSegment } from "../lib/types";

const PX_PER_MIN = 4;
const DAY_MINUTES = 24 * 60;
const TRACK_HEIGHT = 96;

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

  function segmentWidthMin(index: number) {
    const seg = segments[index];
    const next = segments[index + 1];
    const startMin = minutesOf(new Date(seg.startedAt).getTime());
    if (next) {
      const nextStartMin = minutesOf(new Date(next.startedAt).getTime());
      return Math.max(1, Math.min(15, nextStartMin - startMin));
    }
    return 15;
  }

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

          {/* Segments */}
          <div className="absolute inset-x-0" style={{ top: 20, height: 36 }}>
            {segments.map((seg, i) => (
              <div
                key={seg.file}
                className="absolute top-0 h-full rounded bg-accent/60 hover:bg-accent"
                style={{
                  left: minutesOf(new Date(seg.startedAt).getTime()) * PX_PER_MIN,
                  width: segmentWidthMin(i) * PX_PER_MIN,
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
