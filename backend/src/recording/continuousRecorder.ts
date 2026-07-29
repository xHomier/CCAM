import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Camera } from "../db/schema";
import { rtspUrl } from "../go2rtc/client";
import { validateAndPruneSegment } from "./segmentValidation";

const SEGMENT_SECONDS = 900; // 15 min chunks
const MIN_UPTIME_TO_RESET_BACKOFF_MS = 10_000;
const SEGMENT_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/;

export function continuousDir(recordingsPath: string, cameraId: number) {
  return path.join(recordingsPath, String(cameraId), "continuous");
}

export class ContinuousRecorder {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private stopped = false;
  private restartDelayMs = 2000;
  private spawnedAt = 0;

  constructor(
    private camera: Camera,
    private recordingsPath: string
  ) {}

  start() {
    this.stopped = false;
    this.ensureDirAndSpawn();
  }

  /**
   * Creating the storage directory can fail independently of ffmpeg (e.g.
   * the NAS/NFS mount isn't ready yet, or the export path doesn't exist).
   * That must not throw out of start() -- it would abort the whole
   * camera-create/update request and leave live view + AI polling broken
   * too, even though recording is the only thing actually affected. Retry
   * on the same backoff schedule as ffmpeg crashes instead.
   */
  private ensureDirAndSpawn() {
    if (this.stopped) return;
    try {
      fs.mkdirSync(continuousDir(this.recordingsPath, this.camera.id), { recursive: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[recording] could not create storage dir for camera ${this.camera.id} (${this.camera.name}), retrying in ${this.restartDelayMs}ms:`,
        err
      );
      const delay = this.restartDelayMs;
      this.restartDelayMs = Math.min(this.restartDelayMs * 2, 60_000);
      setTimeout(() => this.ensureDirAndSpawn(), delay);
      return;
    }
    this.spawnFfmpeg();
  }

  stop() {
    this.stopped = true;
    this.proc?.kill("SIGTERM");
    this.proc = null;
  }

  /** Restarts ffmpeg only if a field affecting the recorded stream actually changed. */
  updateCamera(camera: Camera) {
    const streamAffectingFieldsChanged =
      camera.continuousStream !== this.camera.continuousStream ||
      camera.host !== this.camera.host ||
      camera.rtspPort !== this.camera.rtspPort ||
      camera.username !== this.camera.username ||
      camera.password !== this.camera.password ||
      camera.channel !== this.camera.channel;

    this.camera = camera;
    if (streamAffectingFieldsChanged) {
      this.stop();
      this.start();
    }
  }

  private spawnFfmpeg() {
    if (this.stopped) return;

    const src = rtspUrl(this.camera, this.camera.continuousStream);
    const outPattern = path.join(
      continuousDir(this.recordingsPath, this.camera.id),
      "%Y-%m-%d_%H-%M-%S.mp4"
    );

    const args = [
      "-nostdin",
      "-loglevel",
      "warning",
      "-rtsp_transport",
      "tcp",
      "-i",
      src,
      "-an",
      "-c",
      "copy",
      "-f",
      "segment",
      "-segment_time",
      String(SEGMENT_SECONDS),
      "-reset_timestamps",
      "1",
      "-strftime",
      "1",
      // Fragmented mp4 per segment: the plain mp4 muxer writes the moov atom
      // (metadata) only after all frames, which some browsers refuse to
      // play back progressively -- this is what caused the "unsupported
      // MIME type" error in the video element.
      "-segment_format_options",
      "movflags=frag_keyframe+empty_moov+default_base_moof",
      outPattern,
    ];

    // Force UTC for the strftime segment filenames regardless of the
    // container's TZ config -- our own code parses those filenames back
    // into Date objects and needs an unambiguous, guaranteed-consistent
    // time base rather than hoping ffmpeg and Node agree on a local zone.
    this.proc = spawn("ffmpeg", args, { env: { ...process.env, TZ: "UTC" } });
    this.spawnedAt = Date.now();

    this.proc.stderr.on("data", () => {
      /* ffmpeg is chatty on stderr even when healthy; swallow by default */
    });

    this.proc.on("exit", (code) => {
      if (this.stopped) return;

      if (Date.now() - this.spawnedAt > MIN_UPTIME_TO_RESET_BACKOFF_MS) {
        this.restartDelayMs = 2000;
      }

      // eslint-disable-next-line no-console
      console.error(
        `[recording] ffmpeg for camera ${this.camera.id} (${this.camera.name}) exited (code ${code}), restarting in ${this.restartDelayMs}ms`
      );

      // An unclean exit (crash, camera drop, container kill) most often
      // happens mid-write on whatever segment is newest -- check it and
      // delete it if it's not a valid, playable mp4. A graceful stop()
      // returns above before reaching here, so this never runs against a
      // segment ffmpeg finalized cleanly on its own.
      const newest = this.findNewestSegment();
      if (newest) {
        validateAndPruneSegment(newest).catch(() => {});
      }

      const delay = this.restartDelayMs;
      this.restartDelayMs = Math.min(this.restartDelayMs * 2, 60_000);
      setTimeout(() => this.ensureDirAndSpawn(), delay);
    });
  }

  private findNewestSegment(): string | null {
    const dir = continuousDir(this.recordingsPath, this.camera.id);
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return null;
    }

    let newest: { file: string; ms: number } | null = null;
    for (const name of entries) {
      const match = name.match(SEGMENT_FILE_RE);
      if (!match) continue;
      const [, y, mo, d, h, mi, s] = match;
      const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
      if (!newest || ms > newest.ms) newest = { file: path.join(dir, name), ms };
    }
    return newest?.file ?? null;
  }
}
