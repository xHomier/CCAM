import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { CcamEvent, RecordingSegment } from "../lib/types";

const DAY_MINUTES = 24 * 60;
const NOMINAL_SEGMENT_MIN = 15; // matches SEGMENT_SECONDS in continuousRecorder.ts
// Segment rotation isn't frame-perfect (ffmpeg cuts at the next keyframe,
// not exactly on the second), so consecutive segments can touch a few
// seconds late without that being a real recording gap. Anything wider than
// this is treated as an actual break in coverage.
const GAP_TOLERANCE_MIN = 1;

const ZOOM_LEVELS = [0.75, 1.5, 3, 6, 12]; // px per minute
const DEFAULT_ZOOM_INDEX = 2;
const TRACK_HEIGHT = 84;
// Wheel/trackpad scrubbing fires continuously; committing a seek on every
// tick would restart the <video> fetch dozens of times a second.
const WHEEL_COMMIT_DELAY_MS = 160;

const TYPE_DOT_CLASS: Record<CcamEvent["type"], string> = {
  person: "bg-accent",
  vehicle: "bg-warning",
  pet: "bg-success",
  motion: "bg-muted",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hourLabelStep(pxPerMin: number) {
  const hourPx = 60 * pxPerMin;
  if (hourPx >= 90) return 1;
  if (hourPx >= 45) return 2;
  if (hourPx >= 24) return 4;
  return 6;
}

/**
 * Milestone XProtect-style scrub bar: the playhead is pinned to the centre
 * and the recording track slides underneath it, rather than a static track
 * with a marker travelling along it. Because the offset is derived from
 * `currentTimeMs`, the track also scrolls itself as playback advances.
 *
 * Dragging only moves a local preview -- the actual seek is committed on
 * release. Seeking on every pointermove would re-issue a Range request for
 * the segment on each frame of the drag, which is what previously flooded
 * the backend with aborted requests.
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const [previewMs, setPreviewMs] = useState<number | null>(null);

  const previewRef = useRef<number | null>(null);
  const dragRef = useRef<{ startX: number; startMs: number; moved: boolean } | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pxPerMin = ZOOM_LEVELS[zoomIndex];
  const dayStartMs = useMemo(() => new Date(`${date}T00:00:00`).getTime(), [date]);
  const dayEndMs = dayStartMs + DAY_MINUTES * 60_000;

  const displayMs = previewMs ?? currentTimeMs ?? dayStartMs;
  const displayMin = clamp((displayMs - dayStartMs) / 60_000, 0, DAY_MINUTES);
  const offsetPx = width / 2 - displayMin * pxPerMin;

  // Read by handlers that must not close over a stale render.
  const displayMsRef = useRef(displayMs);
  displayMsRef.current = displayMs;
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const pxPerMinRef = useRef(pxPerMin);
  pxPerMinRef.current = pxPerMin;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    setWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // Native (non-passive) so horizontal scrubbing doesn't also scroll the page.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const next = clamp(
        displayMsRef.current + (delta / pxPerMinRef.current) * 60_000,
        dayStartMs,
        dayEndMs
      );
      previewRef.current = next;
      setPreviewMs(next);

      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(() => {
        const target = previewRef.current;
        previewRef.current = null;
        setPreviewMs(null);
        if (target !== null) onSeekRef.current(target);
      }, WHEEL_COMMIT_DELAY_MS);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
    };
  }, [dayStartMs, dayEndMs]);

  // Coalesce back-to-back segments into single continuous coverage ranges so
  // the track reads as one recording with real breaks, not as a row of
  // separate clips lined up next to each other.
  const coverageRanges = useMemo(() => {
    const ranges: { startMin: number; endMin: number }[] = [];
    for (const seg of segments) {
      const startMin = clamp((new Date(seg.startedAt).getTime() - dayStartMs) / 60_000, 0, DAY_MINUTES);
      const endMin = Math.min(DAY_MINUTES, startMin + NOMINAL_SEGMENT_MIN);
      const last = ranges[ranges.length - 1];
      if (last && startMin <= last.endMin + GAP_TOLERANCE_MIN) {
        last.endMin = Math.max(last.endMin, endMin);
      } else {
        ranges.push({ startMin, endMin });
      }
    }
    return ranges;
  }, [segments, dayStartMs]);

  function handlePointerDown(e: ReactPointerEvent) {
    const el = containerRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startMs: displayMsRef.current, moved: false };
  }

  function handlePointerMove(e: ReactPointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 2) drag.moved = true;
    if (!drag.moved) return;

    // Dragging the film left moves time forward, like pulling a reel.
    const next = clamp(drag.startMs - (dx / pxPerMin) * 60_000, dayStartMs, dayEndMs);
    previewRef.current = next;
    setPreviewMs(next);
  }

  function handlePointerUp(e: ReactPointerEvent) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    containerRef.current?.releasePointerCapture(e.pointerId);

    if (drag.moved) {
      const target = previewRef.current;
      previewRef.current = null;
      setPreviewMs(null);
      if (target !== null) onSeek(target);
      return;
    }

    // A tap (no drag) seeks to whatever instant sits under the finger.
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxFromCentre = e.clientX - (rect.left + rect.width / 2);
    onSeek(clamp(drag.startMs + (dxFromCentre / pxPerMin) * 60_000, dayStartMs, dayEndMs));
  }

  const labelStep = hourLabelStep(pxPerMin);
  const clock = new Date(displayMs).toLocaleTimeString("fr-CA", { hour12: false });

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-mono text-sm font-medium tabular-nums text-text">{clock}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Dézoomer la ligne de temps"
            disabled={zoomIndex === 0}
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            className="h-7 w-7 rounded-lg border border-border text-sm text-muted transition-colors hover:text-text disabled:opacity-40"
          >
            −
          </button>
          <button
            type="button"
            aria-label="Zoomer la ligne de temps"
            disabled={zoomIndex === ZOOM_LEVELS.length - 1}
            onClick={() => setZoomIndex((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
            className="h-7 w-7 rounded-lg border border-border text-sm text-muted transition-colors hover:text-text disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative cursor-grab touch-none select-none overflow-hidden border-t border-border active:cursor-grabbing"
        style={{ height: TRACK_HEIGHT }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: DAY_MINUTES * pxPerMin,
            transform: `translateX(${offsetPx}px)`,
            willChange: "transform",
          }}
        >
          {/* Hour gridlines */}
          {Array.from({ length: DAY_MINUTES / 60 + 1 }, (_, h) => h)
            .filter((h) => h % labelStep === 0)
            .map((h) => (
              <div
                key={h}
                className="absolute top-0 bottom-0 border-l border-border/70"
                style={{ left: h * 60 * pxPerMin }}
              >
                <span className="absolute top-1 left-1 text-[10px] tabular-nums text-muted">
                  {String(h % 24).padStart(2, "0")}:00
                </span>
              </div>
            ))}

          {/* Continuous recording coverage */}
          <div className="absolute inset-x-0" style={{ top: 22, height: 34 }}>
            {coverageRanges.map((range) => (
              <div
                key={range.startMin}
                className="absolute top-0 h-full rounded-sm bg-accent/55"
                style={{
                  left: range.startMin * pxPerMin,
                  width: Math.max(2, (range.endMin - range.startMin) * pxPerMin),
                }}
              />
            ))}
          </div>

          {/* Events */}
          <div className="absolute inset-x-0" style={{ top: 60, height: 12 }}>
            {events.map((ev) => (
              <div
                key={ev.id}
                className={`absolute top-0 h-full w-1 rounded-full ${TYPE_DOT_CLASS[ev.type]}`}
                style={{
                  left: ((new Date(ev.startedAt).getTime() - dayStartMs) / 60_000) * pxPerMin,
                }}
                title={`${ev.type} @ ${new Date(ev.startedAt).toLocaleTimeString("fr-CA")}`}
              />
            ))}
          </div>
        </div>

        {/* Fixed centre playhead -- the track scrolls underneath it */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 z-10 -translate-x-1/2">
          <div className="h-full w-0.5 bg-danger" />
          <div className="absolute -top-px left-1/2 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[6px] border-x-transparent border-t-danger" />
        </div>
      </div>
    </div>
  );
}
