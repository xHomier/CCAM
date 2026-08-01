import { streamName } from "./client";

const RETRY_BASE_MS = 3000;
const RETRY_MAX_MS = 60_000;

/**
 * Keeps one permanently-open consumer per camera against go2rtc.
 *
 * go2rtc starts a stream's producer lazily -- on the *first* consumer -- and
 * shuts it down once the last one leaves. For an `ffmpeg:` source that means
 * every visit to the live page paid the full cold start: spawn ffmpeg, open
 * the RTSP session, let ffmpeg probe the input, then wait for the camera's
 * next keyframe before a single frame could be handed to the browser. That
 * added up to ~10s of black player on every page load.
 *
 * Holding a consumer open keeps the producer hot, so the browser's own
 * connection starts receiving media almost immediately.
 *
 * The trade-off is that go2rtc now pushes the stream continuously to this
 * process (which discards it) even when nobody is watching. That traffic
 * stays on the Docker network and doesn't add a camera-side RTSP session --
 * go2rtc holds exactly one either way -- so the cost is local bandwidth, not
 * extra load on the camera.
 */
export class StreamWarmer {
  private controllers = new Map<number, AbortController>();
  private retryTimers = new Map<number, NodeJS.Timeout>();
  private retryDelays = new Map<number, number>();

  constructor(private go2rtcApiUrl: string) {}

  warm(cameraId: number) {
    if (this.controllers.has(cameraId) || this.retryTimers.has(cameraId)) return;
    void this.connect(cameraId);
  }

  stop(cameraId: number) {
    this.controllers.get(cameraId)?.abort();
    this.controllers.delete(cameraId);
    const timer = this.retryTimers.get(cameraId);
    if (timer) clearTimeout(timer);
    this.retryTimers.delete(cameraId);
    this.retryDelays.delete(cameraId);
  }

  stopAll() {
    for (const id of new Set([...this.controllers.keys(), ...this.retryTimers.keys()])) {
      this.stop(id);
    }
  }

  private scheduleRetry(cameraId: number) {
    if (this.retryTimers.has(cameraId)) return;
    const delay = this.retryDelays.get(cameraId) ?? RETRY_BASE_MS;
    this.retryDelays.set(cameraId, Math.min(delay * 2, RETRY_MAX_MS));

    const timer = setTimeout(() => {
      this.retryTimers.delete(cameraId);
      void this.connect(cameraId);
    }, delay);
    this.retryTimers.set(cameraId, timer);
  }

  private async connect(cameraId: number) {
    const controller = new AbortController();
    this.controllers.set(cameraId, controller);

    const url = `${this.go2rtcApiUrl}/api/stream.mp4?src=${encodeURIComponent(
      streamName(cameraId)
    )}`;

    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok || !res.body) {
        throw new Error(`go2rtc responded ${res.status}`);
      }
      // Reset the backoff only once we're actually receiving, so a stream
      // that connects and immediately dies still backs off.
      this.retryDelays.set(cameraId, RETRY_BASE_MS);

      const reader = res.body.getReader();
      for (;;) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        // eslint-disable-next-line no-console
        console.error(`[go2rtc] keep-warm consumer for camera ${cameraId} dropped:`, err);
      }
    } finally {
      if (this.controllers.get(cameraId) === controller) {
        this.controllers.delete(cameraId);
      }
    }

    if (!controller.signal.aborted) this.scheduleRetry(cameraId);
  }
}
