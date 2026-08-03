import { useEffect, useRef, useState } from "react";
import type { RecordingSegment } from "../lib/types";
import { ZoomableMedia } from "./ZoomableMedia";

const NEAR_END_SECONDS = 0.35;

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
    const generation = ++seekGeneration.current;

    const slot = activeSlotRef.current;
    const video = videoRefs[slot].current;
    if (!video) return;
    const offsetSec = Math.max(0, (atMs - new Date(segment.startedAt).getTime()) / 1000);

    const start = () => {
      video.currentTime = offsetSec;
      video.play().catch(() => {});
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
    otherVideo.play().catch(() => {});
    activeSlotRef.current = otherSlot;
    setActiveSlot(otherSlot);
    preload(slot, segments[nextIndex + 1]);
  }

  function handleTimeUpdate(slot: 0 | 1) {
    if (slot !== activeSlotRef.current) return;
    const video = videoRefs[slot].current;
    const segment = loadedSegment.current[slot];
    if (!video || !segment) return;

    onTimeUpdate(new Date(segment.startedAt).getTime() + video.currentTime * 1000);
    if (video.duration && video.duration - video.currentTime < NEAR_END_SECONDS) {
      trySwapToNext(slot);
    }
  }

  return (
    <ZoomableMedia>
      <div className="relative h-full w-full">
        {([0, 1] as const).map((slot) => (
          <video
            key={slot}
            ref={videoRefs[slot]}
            muted
            controls
            playsInline
            // "metadata" caps what a non-playing element fetches to the moov
            // header (at the front of the file since +faststart). The default
            // "auto" made the hidden slot download its entire segment, so
            // every scrub cost a full extra file of bandwidth. Once a slot
            // actually plays, the browser streams content on demand anyway.
            preload="metadata"
            onTimeUpdate={() => handleTimeUpdate(slot)}
            onEnded={() => trySwapToNext(slot)}
            className={`absolute inset-0 h-full w-full rounded-xl bg-black ${
              slot === activeSlot ? "z-10 opacity-100" : "pointer-events-none z-0 opacity-0"
            }`}
          />
        ))}
      </div>
    </ZoomableMedia>
  );
}
