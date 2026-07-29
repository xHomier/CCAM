import bcrypt from "bcryptjs";
import { and, count, eq, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { users } from "../../db/schema";

const createSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["admin", "user"]).default("user"),
});

const updateSchema = z.object({
  password: z.string().min(8).optional(),
  role: z.enum(["admin", "user"]).optional(),
  disabled: z.boolean().optional(),
});

function toPublicUser(user: typeof users.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    disabled: user.disabled,
    createdAt: user.createdAt,
  };
}

function countEnabledAdmins(fastify: FastifyInstance, excludeId?: number) {
  const conditions = [eq(users.role, "admin"), eq(users.disabled, false)];
  if (excludeId !== undefined) conditions.push(ne(users.id, excludeId));
  const [{ value }] = fastify.db
    .select({ value: count() })
    .from(users)
    .where(and(...conditions))
    .all();
  return value;
}

export default async function userRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/api/users",
    { preHandler: fastify.requireRole("admin") },
    async () => {
      return fastify.db.select().from(users).all().map(toPublicUser);
    }
  );

  fastify.post(
    "/api/users",
    { preHandler: fastify.requireRole("admin") },
    async (request, reply) => {
      const body = createSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten().fieldErrors });
      }

      const existing = fastify.db
        .select()
        .from(users)
        .where(eq(users.username, body.data.username))
        .get();
      if (existing) {
        return reply.code(409).send({ error: "Username already taken" });
      }

      const passwordHash = await bcrypt.hash(body.data.password, 10);
      const created = fastify.db
        .insert(users)
        .values({ username: body.data.username, passwordHash, role: body.data.role })
        .returning()
        .get();

      return reply.code(201).send(toPublicUser(created));
    }
  );

  fastify.patch<{ Params: { id: string } }>(
    "/api/users/:id",
    { preHandler: fastify.requireRole("admin") },
    async (request, reply) => {
      const id = Number(request.params.id);
      const body = updateSchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten().fieldErrors });
      }

      const target = fastify.db.select().from(users).where(eq(users.id, id)).get();
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }

      const demotingOrDisabling =
        (body.data.role === "user" && target.role === "admin") ||
        (body.data.disabled === true && !target.disabled && target.role === "admin");
      if (demotingOrDisabling && countEnabledAdmins(fastify, id) === 0) {
        return reply.code(409).send({ error: "Cannot remove the last remaining admin" });
      }

      const patch: Partial<typeof users.$inferInsert> = {};
      if (body.data.role !== undefined) patch.role = body.data.role;
      if (body.data.disabled !== undefined) patch.disabled = body.data.disabled;
      if (body.data.password) patch.passwordHash = await bcrypt.hash(body.data.password, 10);

      const updated = fastify.db
        .update(users)
        .set(patch)
        .where(eq(users.id, id))
        .returning()
        .get();

      return toPublicUser(updated);
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/users/:id",
    { preHandler: fastify.requireRole("admin") },
    async (request, reply) => {
      const id = Number(request.params.id);
      const target = fastify.db.select().from(users).where(eq(users.id, id)).get();
      if (!target) {
        return reply.code(404).send({ error: "User not found" });
      }
      if (target.role === "admin" && countEnabledAdmins(fastify, id) === 0) {
        return reply.code(409).send({ error: "Cannot remove the last remaining admin" });
      }

      fastify.db.delete(users).where(eq(users.id, id)).run();
      return reply.code(204).send();
    }
  );
}
