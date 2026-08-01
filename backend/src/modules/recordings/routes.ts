import fs from "node:fs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cameras } from "../../db/schema";
import { continuousDir, SEGMENT_SECONDS } from "../../recording/continuousRecorder";

const SEGMENT_FILE_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.mp4$/;

const querySchema = z.object({
  cameraId: z.coerce.number().int(),
  // ISO instants, not a calendar date string -- segment filenames are UTC
  // (see continuousRecorder.ts) but "today" means the viewer's *local* day,
  // so the frontend resolves the local-day boundaries to UTC instants
  // before asking for them, rather than us guessing a timezone here.
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export default async function recordingRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/recordings",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const query = querySchema.safeParse(request.query);
      if (!query.success) {
        return reply.code(400).send({ error: query.error.flatten().fieldErrors });
      }
      const { cameraId, from, to } = query.data;
      const fromMs = from.getTime();
      const toMs = to.getTime();

      const camera = fastify.db.select().from(cameras).where(eq(cameras.id, cameraId)).get();
      if (!camera) return reply.code(404).send({ error: "Camera not found" });

      const dir = continuousDir(fastify.config.RECORDINGS_PATH, cameraId);
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
          url: `/recordings/${cameraId}/continuous/${name}`,
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
}
