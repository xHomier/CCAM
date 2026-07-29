import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { cameras } from "../../db/schema";
import { streamName } from "../../go2rtc/client";

const cameraInputSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  rtspPort: z.number().int().positive().default(554),
  httpPort: z.number().int().positive().default(80),
  username: z.string().min(1),
  password: z.string().min(1),
  channel: z.number().int().min(0).default(0),
  continuousStream: z.enum(["sub", "main"]).default("sub"),
  aiTypesEnabled: z.array(z.enum(["person", "vehicle", "pet"])).default([
    "person",
    "vehicle",
    "pet",
  ]),
  pollIntervalMs: z.number().int().min(500).default(1500),
  eventCooldownMs: z.number().int().min(0).default(30000),
  retentionDays: z.number().int().min(1).default(14),
  eventRetentionDays: z.number().int().min(1).default(30),
  enabled: z.boolean().default(true),
});

const cameraUpdateSchema = cameraInputSchema.partial();

function toPublicCamera(camera: typeof cameras.$inferSelect) {
  const { password, ...rest } = camera;
  return { ...rest, aiTypesEnabled: JSON.parse(camera.aiTypesEnabled) };
}

export default async function cameraRoutes(fastify: FastifyInstance) {
  fastify.get("/api/cameras", { preHandler: fastify.requireAuth }, async () => {
    return fastify.db.select().from(cameras).all().map(toPublicCamera);
  });

  fastify.get<{ Params: { id: string } }>(
    "/api/cameras/:id",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const camera = fastify.db
        .select()
        .from(cameras)
        .where(eq(cameras.id, Number(request.params.id)))
        .get();
      if (!camera) return reply.code(404).send({ error: "Camera not found" });
      return toPublicCamera(camera);
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/cameras/:id/live",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const id = Number(request.params.id);
      const camera = fastify.db.select().from(cameras).where(eq(cameras.id, id)).get();
      if (!camera) return reply.code(404).send({ error: "Camera not found" });
      return { stream: streamName(id) };
    }
  );

  fastify.post(
    "/api/cameras",
    { preHandler: fastify.requireRole("admin") },
    async (request, reply) => {
      const body = cameraInputSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten().fieldErrors });
      }

      const created = fastify.db
        .insert(cameras)
        .values({ ...body.data, aiTypesEnabled: JSON.stringify(body.data.aiTypesEnabled) })
        .returning()
        .get();

      await fastify.cameraRuntime.upsert(created);
      return reply.code(201).send(toPublicCamera(created));
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    "/api/cameras/:id",
    { preHandler: fastify.requireRole("admin") },
    async (request, reply) => {
      const id = Number(request.params.id);
      const body = cameraUpdateSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten().fieldErrors });
      }

      const existing = fastify.db.select().from(cameras).where(eq(cameras.id, id)).get();
      if (!existing) return reply.code(404).send({ error: "Camera not found" });

      const patch: Record<string, unknown> = { ...body.data, updatedAt: new Date() };
      if (body.data.aiTypesEnabled) {
        patch.aiTypesEnabled = JSON.stringify(body.data.aiTypesEnabled);
      }

      const updated = fastify.db
        .update(cameras)
        .set(patch)
        .where(eq(cameras.id, id))
        .returning()
        .get();

      await fastify.cameraRuntime.upsert(updated);
      return toPublicCamera(updated);
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/cameras/:id",
    { preHandler: fastify.requireRole("admin") },
    async (request, reply) => {
      const id = Number(request.params.id);
      const existing = fastify.db.select().from(cameras).where(eq(cameras.id, id)).get();
      if (!existing) return reply.code(404).send({ error: "Camera not found" });

      fastify.db.delete(cameras).where(eq(cameras.id, id)).run();
      await fastify.cameraRuntime.remove(id);
      return reply.code(204).send();
    }
  );
}
