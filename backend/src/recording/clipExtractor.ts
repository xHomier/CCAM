import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { events, type Event } from "../db/schema";
import { continuousDir } from "./continuousRecorder";
import { publishEvent } from "../sse/eventBus";

const PRE_ROLL_SECONDS = 5;
const POST_ROLL_SECONDS = 10;

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args]);
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

interface Segment {
  file: string;
  startMs: number;
}

function listSegments(dir: string): Segment[] {
  if (!fs.existsSync(dir)) return [];
  const segments: Segment[] = [];
  for (const name of fs.readdirSync(dir)) {
    const match = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/);
    if (!match) continue;
    const [, y, mo, d, h, mi, s] = match;
    // Segment filenames are always UTC (see continuousRecorder.ts) -- must
    // parse with Date.UTC, not the local-time Date constructor.
    const startMs = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s)
    );
    segments.push({ file: path.join(dir, name), startMs });
  }
  return segments.sort((a, b) => a.startMs - b.startMs);
}

export function eventsDir(recordingsPath: string, cameraId: number) {
  return path.join(recordingsPath, String(cameraId), "events");
}

/**
 * Extracts a clip (+ thumbnail) for a closed event from the already-recorded
 * continuous segments -- no dedicated ring-buffer process. Clip resolution is
 * therefore capped at whatever the continuous stream uses (sub-stream by
 * default). See plan doc for the trade-off.
 */
export async function extractEventClip(db: Db, recordingsPath: string, event: Event) {
  const windowStartMs = event.startedAt.getTime() - PRE_ROLL_SECONDS * 1000;
  const windowEndMs = (event.endedAt ?? new Date()).getTime() + POST_ROLL_SECONDS * 1000;

  // The post-roll hasn't been recorded yet when an event closes, and the
  // segment ffmpeg is currently writing hasn't flushed that far either.
  // Wait for the window to actually exist on disk before cutting it out.
  const waitMs = windowEndMs + 5000 - Date.now();
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const dir = continuousDir(recordingsPath, event.cameraId);
  const segments = listSegments(dir);
  if (segments.length === 0) return;

  let coveringIndex = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].startMs <= windowStartMs) {
      coveringIndex = i;
      break;
    }
  }
  const segA = coveringIndex >= 0 ? segments[coveringIndex] : segments[0];
  const segB =
    coveringIndex >= 0 && coveringIndex + 1 < segments.length
      ? segments[coveringIndex + 1]
      : undefined;
  const spansTwoFiles = segB !== undefined && segB.startMs < windowEndMs;

  const outDir = eventsDir(recordingsPath, event.cameraId);
  fs.mkdirSync(outDir, { recursive: true });
  const clipPath = path.join(outDir, `${event.id}.mp4`);
  const thumbnailPath = path.join(outDir, `${event.id}.jpg`);

  const offsetSec = Math.max(0, (windowStartMs - segA.startMs) / 1000);
  const durationSec = (windowEndMs - windowStartMs) / 1000;

  try {
    if (!spansTwoFiles) {
      await runFfmpeg([
        "-ss",
        offsetSec.toFixed(2),
        "-i",
        segA.file,
        "-t",
        durationSec.toFixed(2),
        "-c",
        "copy",
        // Input seeking leaves the first packet at a non-zero (sometimes
        // negative) timestamp, which browsers refuse to play. Rebase to zero
        // and put the moov atom up front for progressive playback.
        "-avoid_negative_ts",
        "make_zero",
        "-movflags",
        "+faststart",
        clipPath,
      ]);
    } else {
      const listFile = path.join(outDir, `${event.id}.concat.txt`);
      fs.writeFileSync(
        listFile,
        [segA.file, segB!.file].map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")
      );
      const combinedPath = path.join(outDir, `${event.id}.combined.mp4`);
      await runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", combinedPath]);
      await runFfmpeg([
        "-ss",
        offsetSec.toFixed(2),
        "-i",
        combinedPath,
        "-t",
        durationSec.toFixed(2),
        "-c",
        "copy",
        "-avoid_negative_ts",
        "make_zero",
        "-movflags",
        "+faststart",
        clipPath,
      ]);
      fs.unlinkSync(listFile);
      fs.unlinkSync(combinedPath);
    }

    await runFfmpeg(["-i", clipPath, "-ss", "1", "-frames:v", "1", thumbnailPath]);

    const updated = db
      .update(events)
      .set({
        clipPath: path.relative(recordingsPath, clipPath),
        thumbnailPath: path.relative(recordingsPath, thumbnailPath),
      })
      .where(eq(events.id, event.id))
      .returning()
      .get();

    // Extraction finishes well after the event itself was pushed over SSE
    // (it needs the post-roll to actually be recorded first) -- push the
    // update too, or the frontend just shows "no clip" until manually
    // refreshed.
    publishEvent(updated);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[recording] clip extraction failed for event ${event.id}:`, err);
  }
}
