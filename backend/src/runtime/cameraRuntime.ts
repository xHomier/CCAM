import type { Db } from "../db/client";
import { cameras, type Camera } from "../db/schema";
import { CameraPoller } from "../reolink/poller";
import { ContinuousRecorder } from "../recording/continuousRecorder";
import { extractEventClip } from "../recording/clipExtractor";
import { syncStream, removeStream } from "../go2rtc/client";

interface Runtime {
  poller: CameraPoller;
  recorder: ContinuousRecorder;
}

/**
 * Owns the per-camera background processes (AI event polling + continuous
 * ffmpeg recording) and keeps them in sync with the `cameras` table whenever
 * the CRUD routes create/update/delete a camera.
 */
export class CameraRuntime {
  private runtimes = new Map<number, Runtime>();

  constructor(
    private db: Db,
    private recordingsPath: string,
    private go2rtcApiUrl: string
  ) {}

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
    const recorder = new ContinuousRecorder(camera, this.recordingsPath);
    this.runtimes.set(camera.id, { poller, recorder });

    poller.start();

    try {
      recorder.start();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[recording] failed to start recorder for camera ${camera.id}:`, err);
    }

    try {
      await syncStream(this.go2rtcApiUrl, camera);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[go2rtc] failed to sync stream for camera ${camera.id}:`, err);
    }
  }

  private stopCamera(cameraId: number) {
    const runtime = this.runtimes.get(cameraId);
    if (!runtime) return;
    runtime.poller.stop();
    runtime.recorder.stop();
    this.runtimes.delete(cameraId);
  }

  /**
   * Stops every recorder/poller so ffmpeg gets a clean SIGTERM and finalizes
   * its currently-open segment before the process exits -- without this, a
   * container restart truncates/corrupts whatever segment was mid-write.
   */
  stopAll() {
    for (const runtime of this.runtimes.values()) {
      runtime.poller.stop();
      runtime.recorder.stop();
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
      try {
        await syncStream(this.go2rtcApiUrl, camera);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[go2rtc] failed to sync stream for camera ${camera.id}:`, err);
      }
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
