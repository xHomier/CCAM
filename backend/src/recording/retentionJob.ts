import fs from "node:fs";
import path from "node:path";
import cron from "node-cron";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { Db } from "../db/client";
import { cameras, events } from "../db/schema";
import { continuousDir } from "./continuousRecorder";
import { eventsDir } from "./clipExtractor";
import { validateAndPruneSegment } from "./segmentValidation";

const SEGMENT_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/;

// Safety-net thresholds for the corruption check below: only worth an
// ffprobe call for suspiciously small files (a legitimately short segment --
// e.g. the camera briefly dropped mid-window -- is still valid footage and
// must not be deleted just for being small), and only once a file is old
// enough that it can't still be the segment ffmpeg is actively writing.
const TINY_SEGMENT_BYTES = 256 * 1024;
const MIN_AGE_FOR_CORRUPTION_CHECK_MS = 2 * 60 * 1000;

async function pruneContinuous(recordingsPath: string, cameraId: number, retentionDays: number) {
  const dir = continuousDir(recordingsPath, cameraId);
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  for (const name of fs.readdirSync(dir)) {
    const match = name.match(SEGMENT_FILE_RE);
    if (!match) continue;
    const [, y, mo, d, h, mi, s] = match;
    // Segment filenames are always UTC (see continuousRecorder.ts).
    const startMs = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(s)
    );
    const filePath = path.join(dir, name);

    if (startMs < cutoff) {
      fs.unlinkSync(filePath);
      continue;
    }

    // Nightly safety net for truncated/corrupt segments the on-exit check
    // in continuousRecorder.ts missed (e.g. from a crash before this
    // feature existed, or a kill that raced past that check).
    try {
      const stat = fs.statSync(filePath);
      if (
        stat.size < TINY_SEGMENT_BYTES &&
        Date.now() - stat.mtimeMs > MIN_AGE_FOR_CORRUPTION_CHECK_MS
      ) {
        await validateAndPruneSegment(filePath);
      }
    } catch {
      /* file may have been removed concurrently -- ignore */
    }
  }
}

function pruneEventFiles(db: Db, recordingsPath: string, cameraId: number, retentionDays: number) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const stale = db
    .select()
    .from(events)
    .where(
      and(eq(events.cameraId, cameraId), isNotNull(events.clipPath), lt(events.startedAt, cutoff))
    )
    .all();

  for (const event of stale) {
    for (const rel of [event.clipPath, event.thumbnailPath]) {
      if (!rel) continue;
      const abs = path.join(recordingsPath, rel);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    }
    db.update(events)
      .set({ clipPath: null, thumbnailPath: null })
      .where(eq(events.id, event.id))
      .run();
  }

  const dir = eventsDir(recordingsPath, cameraId);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
    fs.rmdirSync(dir);
  }
}

export async function runRetentionSweep(db: Db, recordingsPath: string) {
  for (const camera of db.select().from(cameras).all()) {
    try {
      await pruneContinuous(recordingsPath, camera.id, camera.retentionDays);
      pruneEventFiles(db, recordingsPath, camera.id, camera.eventRetentionDays);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[retention] sweep failed for camera ${camera.id}:`, err);
    }
  }
}

export function scheduleRetentionJob(db: Db, recordingsPath: string, timezone: string) {
  return cron.schedule(
    "0 3 * * *",
    () => {
      runRetentionSweep(db, recordingsPath).catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[retention] sweep failed:", err);
      });
    },
    { timezone }
  );
}
