import { useEffect, useRef, useState } from "react";
import { useElementFullscreen } from "../lib/useFullscreen";
import { IconFullscreen } from "./icons";
import { ZoomableMedia } from "./ZoomableMedia";

// Codecs we tell go2rtc the browser can accept (standard go2rtc MSE handshake).
const MSE_CODECS =
  "avc1.640029,avc1.64002A,avc1.640033,hvc1.1.6.L153.B0,mp4a.40.2,mp4a.40.5,flac,opus";

/**
 * Live view via go2rtc's MSE-over-WebSocket consumer (the same default
 * mechanism Frigate uses). HLS was abandoned on purpose: go2rtc kills an
 * HLS session if no *segment* is requested for 5s, and since its ffmpeg
 * producer takes ~3s to start there are no segments to request at startup,
 * so sessions died in a loop before ever playing. The WebSocket has no such
 * keepalive -- it simply stays open and receives fMP4 chunks continuously.
 * Safari/iOS lacks solid MSE, so it gets go2rtc's native HLS URL instead
 * (Safari's own player polls segments aggressively enough to stay alive).
 */
export function Go2RtcPlayer({ streamName }: { streamName: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const { ref: rootRef, isFullscreen, toggle: toggleFullscreen } = useElementFullscreen<HTMLDivElement>();

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setConnecting(true);

    // Clear the overlay as soon as real frames are on screen, so a slow
    // producer start reads as "connecting" rather than a dead black box.
    const onPlaying = () => setConnecting(false);
    video.addEventListener("playing", onPlaying);

    // Safari/iOS: native HLS.
    const isSafari =
      video.canPlayType("application/vnd.apple.mpegurl") !== "" &&
      !("MediaSource" in window && MediaSource.isTypeSupported('video/mp4; codecs="avc1.640029"'));
    if (isSafari) {
      video.src = `/live/api/stream.m3u8?src=${encodeURIComponent(streamName)}`;
      video.play().catch(() => {});
      return () => video.removeEventListener("playing", onPlaying);
    }

    if (!("MediaSource" in window)) {
      setError("Ce navigateur ne supporte pas la lecture du flux en direct.");
      return () => video.removeEventListener("playing", onPlaying);
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let mediaSource: MediaSource | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    let queue: ArrayBuffer[] = [];
    let reconnectDelay = 1000;

    function flushQueue() {
      if (!sourceBuffer || sourceBuffer.updating || queue.length === 0) return;
      const chunk = queue.shift()!;
      try {
        sourceBuffer.appendBuffer(chunk);
      } catch {
        // Buffer full or detached -- drop everything and reconnect fresh.
        scheduleReconnect();
      }
    }

    function trimBuffer() {
      if (!sourceBuffer || sourceBuffer.updating || !video) return;
      const buffered = sourceBuffer.buffered;
      if (buffered.length === 0) return;
      const start = buffered.start(0);
      const end = buffered.end(buffered.length - 1);
      // Keep at most ~30s buffered; trim old data so memory stays flat.
      if (end - start > 30) {
        try {
          sourceBuffer.remove(start, end - 15);
        } catch {
          /* ignore */
        }
      }
      // If playback fell behind the live edge (tab in background, hiccup),
      // jump back to it.
      if (video.currentTime < end - 5) {
        video.currentTime = end - 0.5;
      }
    }

    function scheduleReconnect() {
      if (cancelled) return;
      ws?.close();
      const delay = reconnectDelay;
      reconnectDelay = Math.min(reconnectDelay * 2, 15_000);
      setTimeout(connect, delay);
    }

    function connect() {
      if (cancelled || !video) return;

      queue = [];
      sourceBuffer = null;
      mediaSource = new MediaSource();
      video.src = URL.createObjectURL(mediaSource);

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(
        `${proto}//${location.host}/live/api/ws?src=${encodeURIComponent(streamName)}`
      );
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        ws!.send(JSON.stringify({ type: "mse", value: MSE_CODECS }));
      };

      ws.onmessage = (msg) => {
        if (typeof msg.data === "string") {
          const data = JSON.parse(msg.data) as { type: string; value: string };
          if (data.type !== "mse") return;

          const initSourceBuffer = () => {
            if (cancelled || !mediaSource) return;
            try {
              sourceBuffer = mediaSource.addSourceBuffer(data.value);
              sourceBuffer.mode = "segments";
              sourceBuffer.addEventListener("updateend", () => {
                flushQueue();
                trimBuffer();
              });
              flushQueue();
            } catch {
              setError("Codec du flux non supporté par ce navigateur.");
            }
          };

          if (mediaSource!.readyState === "open") initSourceBuffer();
          else mediaSource!.addEventListener("sourceopen", initSourceBuffer, { once: true });
        } else {
          reconnectDelay = 1000;
          queue.push(msg.data as ArrayBuffer);
          flushQueue();
        }
      };

      ws.onclose = () => {
        if (!cancelled) scheduleReconnect();
      };
      ws.onerror = () => {
        ws?.close();
      };

      video.play().catch(() => {});
    }

    connect();

    return () => {
      cancelled = true;
      video.removeEventListener("playing", onPlaying);
      ws?.close();
      if (video.src.startsWith("blob:")) URL.revokeObjectURL(video.src);
      video.src = "";
    };
  }, [streamName]);

  return (
    <div
      ref={rootRef}
      className={
        isFullscreen
          ? "fixed inset-0 z-50 h-screen w-screen overflow-hidden bg-black"
          : "relative aspect-video w-full overflow-hidden rounded-xl bg-black"
      }
    >
      <ZoomableMedia>
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          // No native controls: there is nothing here for them to offer --
          // seeking a live stream isn't meaningful, and going through
          // iOS/Android's own player chrome is exactly what the custom
          // fullscreen button below replaces. playsInline keeps iOS from
          // ever handing playback to that native chrome on its own, even
          // without a tap on any control.
          autoPlay
          muted
          playsInline
        />
      </ZoomableMedia>
      {connecting && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-muted/40 border-t-accent" />
          Connexion au flux…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-4 text-center text-sm text-danger">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? "Quitter le plein écran" : "Plein écran"}
        // Left corner deliberately: ZoomableMedia's own "Réinitialiser le
        // zoom" badge sits bottom-right, and the two would overlap once zoomed.
        className="absolute bottom-2 left-2 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-text backdrop-blur transition-colors hover:bg-white/25"
      >
        <IconFullscreen width={14} height={14} active={isFullscreen} />
      </button>
    </div>
  );
}
