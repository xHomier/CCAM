import { and, desc, eq, gte, lte, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { events } from "../../db/schema";
import { eventBus, EVENT_CHANNEL } from "../../sse/eventBus";

const listQuerySchema = z.object({
  cameraId: z.coerce.number().int().optional(),
  type: z.enum(["person", "vehicle", "pet", "motion"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export default async function eventRoutes(fastify: FastifyInstance) {
  fastify.get("/api/events", { preHandler: fastify.requireAuth }, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send({ error: query.error.flatten().fieldErrors });
    }
    const { cameraId, type, from, to, cursor, limit } = query.data;

    const conditions = [];
    if (cameraId !== undefined) conditions.push(eq(events.cameraId, cameraId));
    if (type !== undefined) conditions.push(eq(events.type, type));
    if (from !== undefined) conditions.push(gte(events.startedAt, from));
    if (to !== undefined) conditions.push(lte(events.startedAt, to));
    if (cursor !== undefined) conditions.push(lt(events.id, cursor));

    return fastify.db
      .select()
      .from(events)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(events.id))
      .limit(limit)
      .all();
  });

  fastify.get<{ Params: { id: string } }>(
    "/api/events/:id",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      const event = fastify.db
        .select()
        .from(events)
        .where(eq(events.id, Number(request.params.id)))
        .get();
      if (!event) return reply.code(404).send({ error: "Event not found" });
      return event;
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/events/:id",
    { preHandler: fastify.requireRole("admin") },
    async (request, reply) => {
      const id = Number(request.params.id);
      const existing = fastify.db.select().from(events).where(eq(events.id, id)).get();
      if (!existing) return reply.code(404).send({ error: "Event not found" });
      fastify.db.delete(events).where(eq(events.id, id)).run();
      return reply.code(204).send();
    }
  );

  fastify.get(
    "/api/events/stream",
    { preHandler: fastify.requireAuth },
    async (request, reply) => {
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      reply.raw.write(": connected\n\n");

      const onEvent = (event: unknown) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      eventBus.on(EVENT_CHANNEL, onEvent);

      const heartbeat = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        eventBus.off(EVENT_CHANNEL, onEvent);
      });
    }
  );
}
