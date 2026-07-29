import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { users } from "../../db/schema";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid request" });
    }

    const user = fastify.db
      .select()
      .from(users)
      .where(eq(users.username, body.data.username))
      .get();

    if (!user || user.disabled) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(body.data.password, user.passwordHash);
    if (!valid) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    request.session.set("userId", user.id);
    request.session.set("role", user.role);

    return { id: user.id, username: user.username, role: user.role };
  });

  fastify.post("/api/auth/logout", async (request, reply) => {
    request.session.delete();
    return reply.code(204).send();
  });

  fastify.get("/api/auth/me", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    const user = fastify.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user || user.disabled) {
      request.session.delete();
      return reply.code(401).send({ error: "Unauthorized" });
    }

    return { id: user.id, username: user.username, role: user.role };
  });
}
