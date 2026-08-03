import fs from "node:fs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cameras } from "../../db/schema";
import { continuousDir, previewDir, SEGMENT_SECONDS } from "../../recording/continuousRecorder";

const SEGMENT_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/;

const querySchema = z.object({
  cameraId: z.coerce.number().int(),
  // ISO instants, not a calendar date string -- segment filenames are UTC
  // (see continuousRecorder.ts) but "today" means the viewer's *local* day,
  // so the frontend resolves the local-day boundaries to UTC instants
  // before asking for them, rather than us guessing a timezone here.
  from: z.coerce.date(),
  to: z.coerce.date(),
  // "preview" lists the parallel sub-stream copy (small files, fast to
  // scrub); "quality" the primary recording used for clips and export. The
  // response shape is identical, so the frontend can fetch both and fall
  // back to quality when no preview recording exists for this camera.
  variant: z.enum(["quality", "preview"]).default("quality"),
});

const exportQuerySchema = z.object({
  cameraId: z.coerce.number().int(),
  at: z.coerce.date(),
});

interface DiscoveredSegment {
  name: string;
  startedAtMs: number;
}

/** Lists a directory's segments, oldest first, parsing UTC times from names. */
function listSegments(dir: string): DiscoveredSegment[] {
  if (!fs.existsSync(dir)) return [];
  const found: DiscoveredSegment[] = [];
  for (const name of fs.readdirSync(dir)) {
    const match = name.match(SEGMENT_FILE_RE);
    if (!match) continue;
    const [, y, mo, d, h, mi, s] = match;
    found.push({
      name,
      startedAtMs: Date.UTC(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h),
        Number(mi),
        Number(s)
      ),
    });
  }
  return found.sort((a, b) => a.startedAtMs - b.startedAtMs);
}

export default async function recordingRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/recordings",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const query = querySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: query.error.flatten().fieldErrors });
      }
      const { cameraId, from, to, variant } = query.data;
      const fromMs = from.getTime();
      const toMs = to.getTime();

      const camera = fastify.db.select().from(cameras).where(eq(cameras.id, cameraId)).get();
      if (!camera) return reply.code(404).send({ error: "Camera not found" });

      const dir =
        variant === "preview"
          ? previewDir(fastify.config.RECORDINGS_PATH, cameraId)
          : continuousDir(fastify.config.RECORDINGS_PATH, cameraId);
      const urlDir = variant === "preview" ? "continuous_sub" : "continuous";
      if (!fs.existsSync(dir)) return [];

      const segments = [];
      for (const name of fs.readdirSync(dir)) {
        const match = name.match(SEGMENT_FILE_RE);
        if (!match) continue;
        const [, y, mo, d, h, mi, s] = match;
        // Segment filenames are always UTC (see continuousRecorder.ts).
        const startedAtMs = Date.UTC(
          Number(y),
          Number(mo) - 1,
          Number(d),
          Number(h),
          Number(mi),
          Number(s)
        );
        if (startedAtMs < fromMs || startedAtMs > toMs) continue;

        const stat = fs.statSync(`${dir}/${name}`);
        segments.push({
          file: name,
          startedAt: new Date(startedAtMs),
          sizeBytes: stat.size,
          url: `/recordings/${cameraId}/${urlDir}/${name}`,
        });
      }

      segments.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

      // Drop the segment ffmpeg is still writing. Its moov atom is only
      // written when the file rotates, so serving it hands the player a file
      // it cannot decode -- a black frame that never resolves. A segment can
      // only still be open if it started less than one segment ago.
      const newest = segments[segments.length - 1];
      if (newest && Date.now() - newest.startedAt.getTime() < SEGMENT_SECONDS * 1000) {
        segments.pop();
      }

      return segments;
    }
  );

  /**
   * Resolves the main-quality file covering a given instant.
   *
   * The viewer scrubs the light sub-stream copy, but an export has to come
   * from the quality recording. The two recorders rotate independently, so
   * their filenames drift by a second or two and cannot be mapped by name --
   * this matches on time instead, which is what actually lines them up.
   */
  fastify.get(
    "/api/recordings/export",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const query = exportQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: query.error.flatten().fieldErrors });
      }
      const { cameraId, at } = query.data;

      const camera = fastify.db.select().from(cameras).where(eq(cameras.id, cameraId)).get();
      if (!camera) return reply.code(404).send({ error: "Camera not found" });

      const atMs = at.getTime();
      const segments = listSegments(continuousDir(fastify.config.RECORDINGS_PATH, cameraId));

      // The covering segment is the last one that started at or before the
      // requested instant, provided the instant falls inside its span.
      let covering: DiscoveredSegment | undefined;
      for (const segment of segments) {
        if (segment.startedAtMs > atMs) break;
        covering = segment;
      }
      if (!covering || atMs - covering.startedAtMs > SEGMENT_SECONDS * 1000) {
        return reply.code(404).send({ error: "No quality recording covers that moment" });
      }

      return {
        file: covering.name,
        startedAt: new Date(covering.startedAtMs),
        url: `/recordings/${cameraId}/continuous/${covering.name}`,
      };
    }
  );
}
