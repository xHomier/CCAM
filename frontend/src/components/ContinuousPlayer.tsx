import { useEffect, useRef, useState } from "react";
import type { RecordingSegment } from "../lib/types";
import { ZoomableMedia } from "./ZoomableMedia";

// Lead time before a segment ends at which the next one is swapped in. This is
// wall-clock, so it has to scale with playback rate: at 8x, 0.35s of media is
// only ~44ms of real time, far too late to hand over cleanly.
const NEAR_END_SECONDS = 0.35;

const SPEEDS = [0.25, 0.5, 0.75, 1, 2, 4, 8] as const;
const SKIP_SECONDS = 10;

/**
 * `Element.requestFullscreen` on Safari/iOS is still exposed under its
 * WebKit-prefixed name in the TS DOM lib. Kept to a couple of narrow
 * interfaces rather than reaching for `any` at every call site.
 */
interface FullscreenCapableElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}
interface FullscreenCapableDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}

/**
 * Plays a day's continuous recording across many 15-minute segment files
 * without a visible cut at each boundary. A single <video> swapping `src`
 * at the boundary causes a network fetch + reload right when playback needs
 * it most, which shows as a stutter/black-flash. Instead this keeps two
 * <video> elements: one playing, one silently preloaded with the *next*
 * segment far in advance (a whole 15-minute segment's worth of lead time),
 * and swaps which one is visible the instant the active one ends.
 */
export function ContinuousPlayer({
  segments,
  seekRequest,
  onTimeUpdate,
}: {
  segments: RecordingSegment[]; // must be sorted ascending by startedAt
  seekRequest: { atMs: number; nonce: number } | null;
  onTimeUpdate: (atMs: number) => void;
}) {
  const videoRefs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)] as const;
  const loadedFile = useRef<[string | null, string | null]>([null, null]);
  const loadedSegment = useRef<[RecordingSegment | null, RecordingSegment | null]>([null, null]);
  const currentIndex = useRef(-1);
  const lastNonce = useRef<number | null>(null);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const activeSlotRef = useRef<0 | 1>(0);
  // Identifies the most recent seek. Rapid scrubbing used to stack one
  // "canplay" listener per seek, and when the video finally became playable
  // they all fired back-to-back -- each preloading a different notion of the
  // "next" segment, kicking off a burst of competing downloads that saturated
  // the connection until even API calls stalled. Only the listener belonging
  // to the latest seek is allowed to do anything.
  const seekGeneration = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // Read by the segment-swap path, which must not depend on a re-render to
  // carry the current rate over to the incoming element.
  const speedRef = useRef(1);
  speedRef.current = speed;
  const playingRef = useRef(false);
  playingRef.current = playing;
  // Absolute playback position, kept alongside the onTimeUpdate callback so
  // the +10/-10 buttons have something to offset from without waiting on a
  // render.
  const currentAbsMsRef = useRef<number | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  function isNativeFullscreen() {
    const doc = document as FullscreenCapableDocument;
    return (
      (doc.fullscreenElement ?? null) === rootRef.current ||
      (doc.webkitFullscreenElement ?? null) === rootRef.current
    );
  }

  // Deliberately requests fullscreen on this wrapper <div>, never on the
  // <video> elements. Calling fullscreen on a video is what hands playback to
  // iOS's own AVPlayer chrome -- native controls, its own play/seek/AirPlay
  // bar -- which is exactly the UI this component replaces. A plain element
  // going fullscreen just grows to fill the screen and keeps rendering our
  // own controls underneath.
  async function enterFullscreen() {
    const el = rootRef.current;
    if (!el) return;
    // Applied immediately regardless of what follows: on a browser with no
    // Fullscreen API for arbitrary elements (pre-16.4 iOS Safari), this CSS
    // state is the *only* fullscreen there is. Where the real API is
    // available it simply doubles up with the UA's own fullscreen styling.
    setIsFullscreen(true);
    try {
      const fsEl = el as FullscreenCapableElement;
      if (fsEl.requestFullscreen) await fsEl.requestFullscreen();
      else fsEl.webkitRequestFullscreen?.();
    } catch {
      /* denied or unsupported -- the CSS fallback above already covers it */
    }
  }

  function exitFullscreen() {
    if (isNativeFullscreen()) {
      const doc = document as FullscreenCapableDocument;
      if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    }
    setIsFullscreen(false);
  }

  function toggleFullscreen() {
    if (isFullscreen) exitFullscreen();
    else enterFullscreen();
  }

  // Catches the device's own exit gestures (swipe-down, Android back, Esc) so
  // our CSS state doesn't stay stuck on after the browser has already left
  // fullscreen.
  useEffect(() => {
    function handleChange() {
      const doc = document as FullscreenCapableDocument;
      if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
        setIsFullscreen(false);
      }
    }
    document.addEventListener("fullscreenchange", handleChange);
    document.addEventListener("webkitfullscreenchange", handleChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleChange);
      document.removeEventListener("webkitfullscreenchange", handleChange);
    };
  }, []);

  /** Both elements share the rate so a swap can't visibly change speed. */
  useEffect(() => {
    for (const ref of videoRefs) {
      if (ref.current) ref.current.playbackRate = speed;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  function togglePlay() {
    const video = videoRefs[activeSlotRef.current].current;
    if (!video) return;
    if (video.paused) {
      video.playbackRate = speedRef.current;
      video.play().catch(() => {});
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
    }
  }

  function segmentIndexAt(atMs: number) {
    let idx = 0;
    for (let i = 0; i < segments.length; i++) {
      if (new Date(segments[i].startedAt).getTime() <= atMs) idx = i;
      else break;
    }
    return idx;
  }

  function preload(slot: 0 | 1, segment: RecordingSegment | undefined) {
    const video = videoRefs[slot].current;
    if (!video) return;
    if (!segment) {
      loadedFile.current[slot] = null;
      loadedSegment.current[slot] = null;
      return;
    }
    if (loadedFile.current[slot] === segment.file) return;
    loadedFile.current[slot] = segment.file;
    loadedSegment.current[slot] = segment;
    video.src = segment.url;
    video.load();
  }

  function jumpTo(atMs: number) {
    if (segments.length === 0) return;
    const idx = segmentIndexAt(atMs);
    const segment = segments[idx];
    currentIndex.current = idx;
    currentAbsMsRef.current = atMs;
    const generation = ++seekGeneration.current;

    const slot = activeSlotRef.current;
    const video = videoRefs[slot].current;
    if (!video) return;
    const offsetSec = Math.max(0, (atMs - new Date(segment.startedAt).getTime()) / 1000);

    const start = () => {
      video.currentTime = offsetSec;
      video.playbackRate = speedRef.current;
      video.play().catch(() => {});
      setPlaying(true);
    };

    if (loadedFile.current[slot] === segment.file) {
      start();
    } else {
      loadedFile.current[slot] = segment.file;
      loadedSegment.current[slot] = segment;
      video.src = segment.url;
      video.onloadedmetadata = start;
    }

    // Hold the next segment back until the one being watched is playable.
    // Kicking both off together split the available bandwidth exactly when
    // the viewer is waiting on the first frame, which is the slowest moment.
    const otherSlot: 0 | 1 = slot === 0 ? 1 : 0;
    const next = segments[idx + 1];
    if (!next) {
      preload(otherSlot, undefined);
      return;
    }
    const preloadIfCurrent = () => {
      if (seekGeneration.current === generation) preload(otherSlot, next);
    };
    if (video.readyState >= 3 /* HAVE_FUTURE_DATA */) {
      preloadIfCurrent();
    } else {
      video.addEventListener("canplay", preloadIfCurrent, { once: true });
    }
  }

  useEffect(() => {
    if (!seekRequest || seekRequest.nonce === lastNonce.current) return;
    lastNonce.current = seekRequest.nonce;
    jumpTo(seekRequest.atMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest]);

  /**
   * +/-10s. Deliberately not just `jumpTo(currentAbsMs + delta)` for the
   * common case: jumpTo always resumes playback (right for "go watch this
   * moment" from the timeline), but a skip button is expected to leave a
   * paused video paused. When the target stays inside the segment already
   * loaded, this sets currentTime directly and leaves play state untouched;
   * it only falls back to jumpTo -- and its resume-on-load behaviour -- when
   * the skip actually crosses into a different segment.
   */
  function skip(deltaSec: number) {
    if (currentAbsMsRef.current === null || segments.length === 0) return;
    const target = currentAbsMsRef.current + deltaSec * 1000;
    const idx = segmentIndexAt(target);
    const slot = activeSlotRef.current;
    const video = videoRefs[slot].current;
    const segment = segments[idx];

    if (video && segment && idx === currentIndex.current && loadedFile.current[slot] === segment.file) {
      const offsetSec = Math.max(0, (target - new Date(segment.startedAt).getTime()) / 1000);
      video.currentTime = offsetSec;
      currentAbsMsRef.current = target;
      onTimeUpdate(target);
    } else {
      jumpTo(target);
    }
  }

  function trySwapToNext(slot: 0 | 1) {
    if (slot !== activeSlotRef.current) return;
    const nextIndex = currentIndex.current + 1;
    const nextSegment = segments[nextIndex];
    const otherSlot: 0 | 1 = slot === 0 ? 1 : 0;
    if (!nextSegment || loadedFile.current[otherSlot] !== nextSegment.file) return;

    const otherVideo = videoRefs[otherSlot].current;
    if (!otherVideo) return;

    currentIndex.current = nextIndex;
    otherVideo.currentTime = 0;
    otherVideo.playbackRate = speedRef.current;
    if (playingRef.current) otherVideo.play().catch(() => {});
    activeSlotRef.current = otherSlot;
    setActiveSlot(otherSlot);
    preload(slot, segments[nextIndex + 1]);
  }

  function handleTimeUpdate(slot: 0 | 1) {
    if (slot !== activeSlotRef.current) return;
    const video = videoRefs[slot].current;
    const segment = loadedSegment.current[slot];
    if (!video || !segment) return;

    const absMs = new Date(segment.startedAt).getTime() + video.currentTime * 1000;
    currentAbsMsRef.current = absMs;
    onTimeUpdate(absMs);
    if (
      video.duration &&
      video.duration - video.currentTime < NEAR_END_SECONDS * speedRef.current
    ) {
      trySwapToNext(slot);
    }
  }

  return (
    <div
      ref={rootRef}
      className={
        isFullscreen
          ? "fixed inset-0 z-50 h-screen w-screen bg-black"
          : "relative h-full w-full"
      }
    >
      <ZoomableMedia>
        <div className="relative h-full w-full">
          {([0, 1] as const).map((slot) => (
          <video
            key={slot}
            ref={videoRefs[slot]}
            muted
            // No native controls: seeking belongs to the timeline below and
            // the buttons underneath, the recordings carry no audio track
            // (-an at capture), and the two stacked elements would each
            // render their own bar.
            playsInline
            // "metadata" caps what a non-playing element fetches to the moov
            // header (at the front of the file since +faststart). The default
            // "auto" made the hidden slot download its entire segment, so
            // every scrub cost a full extra file of bandwidth. Once a slot
            // actually plays, the browser streams content on demand anyway.
            preload="metadata"
            onTimeUpdate={() => handleTimeUpdate(slot)}
            onEnded={() => trySwapToNext(slot)}
            onPlay={() => slot === activeSlotRef.current && setPlaying(true)}
            onPause={() => slot === activeSlotRef.current && setPlaying(false)}
            className={`absolute inset-0 h-full w-full bg-black object-contain ${
              isFullscreen ? "" : "rounded-xl"
            } ${slot === activeSlot ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"}`}
          />
          ))}
        </div>
      </ZoomableMedia>

      {/* Sibling of ZoomableMedia, not a child: inside it the buttons would be
          scaled by the digital zoom and their taps consumed by its pan
          handler. */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-2 bg-gradient-to-t from-black/80 to-transparent pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-6 ${
          isFullscreen ? "" : "rounded-b-xl"
        }`}
      >
        <button
          type="button"
          onClick={() => skip(-SKIP_SECONDS)}
          aria-label={`Reculer de ${SKIP_SECONDS} secondes`}
          className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 text-text backdrop-blur transition-colors hover:bg-white/25"
        >
          <SkipIcon direction="back" />
          <span className="text-xs font-semibold tabular-nums">{SKIP_SECONDS}</span>
        </button>

        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Lecture"}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-text backdrop-blur transition-colors hover:bg-white/25"
        >
          {playing ? (
            <svg width="14" height="14" viewBox="0 0 12 14" aria-hidden="true">
              <rect x="0" y="0" width="4" height="14" rx="1" fill="currentColor" />
              <rect x="8" y="0" width="4" height="14" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 12 14" aria-hidden="true">
              <path d="M0 0 L12 7 L0 14 Z" fill="currentColor" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={() => skip(SKIP_SECONDS)}
          aria-label={`Avancer de ${SKIP_SECONDS} secondes`}
          className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 text-text backdrop-blur transition-colors hover:bg-white/25"
        >
          <span className="text-xs font-semibold tabular-nums">{SKIP_SECONDS}</span>
          <SkipIcon direction="forward" />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold tabular-nums transition-colors ${
                s === speed
                  ? "bg-accent text-bg"
                  : "bg-white/10 text-text backdrop-blur hover:bg-white/20"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
          className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-text backdrop-blur transition-colors hover:bg-white/25"
        >
          <FullscreenIcon active={isFullscreen} />
        </button>
      </div>
    </div>
  );
}

function SkipIcon({ direction }: { direction: "back" | "forward" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ transform: direction === "back" ? "scaleX(-1)" : undefined }}
    >
      <path d="M11 6 L4 12 L11 18 Z" fill="currentColor" />
      <path d="M19 6 L12 12 L19 18 Z" fill="currentColor" />
    </svg>
  );
}

function FullscreenIcon({ active }: { active: boolean }) {
  // Corners pointing outward when entering fullscreen, inward when already
  // in it -- the same expand/compress convention every video player uses.
  return active ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 4 L9 9 L4 9 M15 4 L15 9 L20 9 M9 20 L9 15 L4 15 M15 20 L15 15 L20 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9 L4 4 L9 4 M15 4 L20 4 L20 9 M20 15 L20 20 L15 20 M9 20 L4 20 L4 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
