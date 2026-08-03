import type { Db } from "../db/client";
import { cameras, type Camera } from "../db/schema";
import { CameraPoller } from "../reolink/poller";
import { ContinuousRecorder } from "../recording/continuousRecorder";
import { extractEventClip } from "../recording/clipExtractor";
import { syncStream, removeStream } from "../go2rtc/client";
import { StreamWarmer } from "../go2rtc/streamWarmer";

interface Runtime {
  poller: CameraPoller;
  recorder: ContinuousRecorder;
  /**
   * Parallel sub-stream recorder feeding the Recordings page a low-bitrate
   * copy to scrub through (~10% extra storage, no CPU -- the camera encodes
   * both streams anyway). Only exists when the primary recording is the main
   * stream; if the primary is already sub, a copy would be identical.
   */
  previewRecorder?: ContinuousRecorder;
}

function wantsPreviewRecording(camera: Camera) {
  return camera.continuousStream === "main";
}

/**
 * Owns the per-camera background processes (AI event polling + continuous
 * ffmpeg recording) and keeps them in sync with the `cameras` table whenever
 * the CRUD routes create/update/delete a camera.
 */
export class CameraRuntime {
  private runtimes = new Map<number, Runtime>();
  private warmer: StreamWarmer;

  constructor(
    private db: Db,
    private recordingsPath: string,
    private go2rtcApiUrl: string
  ) {
    this.warmer = new StreamWarmer(go2rtcApiUrl);
  }

  async start() {
    const all = this.db.select().from(cameras).all();
    for (const camera of all) {
      if (camera.enabled) {
        await this.startCamera(camera);
      }
    }
  }

  private async startCamera(camera: Camera) {
    const poller = new CameraPoller(camera, this.db, (event) => {
      extractEventClip(this.db, this.recordingsPath, event).catch(() => {
        /* extractEventClip logs its own failures */
      });
    });
    const recorder = new ContinuousRecorder(camera, this.recordingsPath, "quality");
    const previewRecorder = wantsPreviewRecording(camera)
      ? new ContinuousRecorder(camera, this.recordingsPath, "preview")
      : undefined;
    this.runtimes.set(camera.id, { poller, recorder, previewRecorder });

    poller.start();

    try {
      recorder.start();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[recording] failed to start recorder for camera ${camera.id}:`, err);
    }
    try {
      previewRecorder?.start();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[recording] failed to start preview recorder for camera ${camera.id}:`, err);
    }

    try {
      await syncStream(this.go2rtcApiUrl, camera);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[go2rtc] failed to sync stream for camera ${camera.id}:`, err);
    }

    // Only meaningful once the stream exists in go2rtc, hence after sync.
    this.warmer.warm(camera.id);
  }

  private stopCamera(cameraId: number) {
    this.warmer.stop(cameraId);
    const runtime = this.runtimes.get(cameraId);
    if (!runtime) return;
    runtime.poller.stop();
    runtime.recorder.stop();
    runtime.previewRecorder?.stop();
    this.runtimes.delete(cameraId);
  }

  /**
   * Stops every recorder/poller so ffmpeg gets a clean SIGTERM and finalizes
   * its currently-open segment before the process exits -- without this, a
   * container restart truncates/corrupts whatever segment was mid-write.
   */
  stopAll() {
    this.warmer.stopAll();
    for (const runtime of this.runtimes.values()) {
      runtime.poller.stop();
      runtime.recorder.stop();
      runtime.previewRecorder?.stop();
    }
  }

  /** Call after a camera is created or updated. */
  async upsert(camera: Camera) {
    if (!camera.enabled) {
      this.stopCamera(camera.id);
      await removeStream(this.go2rtcApiUrl, camera.id);
      return;
    }

    const runtime = this.runtimes.get(camera.id);
    if (runtime) {
      runtime.poller.updateCamera(camera);
      runtime.recorder.updateCamera(camera);

      // Whether a preview recorder should exist depends on continuousStream,
      // which this update may just have flipped.
      if (wantsPreviewRecording(camera) && !runtime.previewRecorder) {
        runtime.previewRecorder = new ContinuousRecorder(camera, this.recordingsPath, "preview");
        try {
          runtime.previewRecorder.start();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            `[recording] failed to start preview recorder for camera ${camera.id}:`,
            err
          );
        }
      } else if (!wantsPreviewRecording(camera) && runtime.previewRecorder) {
        runtime.previewRecorder.stop();
        runtime.previewRecorder = undefined;
      } else {
        runtime.previewRecorder?.updateCamera(camera);
      }

      try {
        await syncStream(this.go2rtcApiUrl, camera);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[go2rtc] failed to sync stream for camera ${camera.id}:`, err);
      }
      // syncStream may have replaced the source (host/credentials edited),
      // which leaves the existing keep-warm consumer bound to the old
      // producer -- reattach it to the new one.
      this.warmer.stop(camera.id);
      this.warmer.warm(camera.id);
    } else {
      await this.startCamera(camera);
    }
  }

  /** Call after a camera is deleted. */
  async remove(cameraId: number) {
    this.stopCamera(cameraId);
    await removeStream(this.go2rtcApiUrl, cameraId);
  }
}
