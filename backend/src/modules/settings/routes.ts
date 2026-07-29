import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { settings } from "../../db/schema";

const patchSchema = z.record(z.string(), z.string());

export default async function settingsRoutes(fastify: FastifyInstance) {
  fastify.get("/api/settings", { preHandler: fastify.requireRole("admin") }, async () => {
    const rows = fastify.db.select().from(settings).all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  });

  fastify.patch(
    "/api/settings",
    { preHandler: fastify.requireRole("admin") },
    async (request, reply) => {
      const body = patchSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten().fieldErrors });
      }

      for (const [key, value] of Object.entries(body.data)) {
        const existing = fastify.db.select().from(settings).where(eq(settings.key, key)).get();
        if (existing) {
          fastify.db.update(settings).set({ value }).where(eq(settings.key, key)).run();
        } else {
          fastify.db.insert(settings).values({ key, value }).run();
        }
      }

      const rows = fastify.db.select().from(settings).all();
      return Object.fromEntries(rows.map((r) => [r.key, r.value]));
    }
  );
}
