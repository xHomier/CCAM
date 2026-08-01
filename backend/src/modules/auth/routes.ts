import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { users } from "../../db/schema";

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/api/auth/login", async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      // Logged because an empty/blank username here means the *client* sent
      // nothing -- e.g. a mobile autofill that never reached the form state --
      // which is indistinguishable from a bad password at the UI.
      request.log.warn(
        { fields: body.error.flatten().fieldErrors, userAgent: request.headers["user-agent"] },
        "login rejected: malformed body"
      );
      return reply.code(400).send({ error: "Invalid request" });
    }

    // Usernames are matched case-insensitively and whitespace-tolerantly.
    // A phone keyboard capitalises the first letter and can append a space,
    // so an exact binary comparison (SQLite's default for TEXT) rejected the
    // same credentials that worked when typed on a desktop keyboard.
    const user = fastify.db
      .select()
      .from(users)
      .where(sql`lower(trim(${users.username})) = lower(${body.data.username})`)
      .get();

    // Never log the password. The username is quoted so invisible differences
    // (case, stray whitespace, smart quotes from a phone keyboard) are
    // actually visible in the log line.
    const attempt = {
      username: JSON.stringify(body.data.username),
      userFound: Boolean(user),
      protocol: request.protocol,
      userAgent: request.headers["user-agent"],
    };

    if (!user || user.disabled) {
      request.log.warn(
        { ...attempt, reason: user ? "account disabled" : "no such user" },
        "login failed"
      );
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(body.data.password, user.passwordHash);
    if (!valid) {
      request.log.warn({ ...attempt, reason: "wrong password" }, "login failed");
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    request.session.set("userId", user.id);
    request.session.set("role", user.role);

    // `protocol` decides whether the session cookie gets the Secure flag, so
    // it's worth seeing on a successful login too.
    request.log.info({ ...attempt, userId: user.id }, "login succeeded");

    return { id: user.id, username: user.username, role: user.role };
  });

  fastify.post("/api/auth/logout", async (request, reply) => {
    request.session.delete();
    return reply.code(204).send();
  });

  fastify.get("/api/auth/me", async (request, reply) => {
    const userId = request.session.get("userId");
    if (!userId) {
      // Separates "the browser never sent the cookie" (not stored, wrong
      // attributes, cleared by the OS) from "it sent one we couldn't read"
      // (key rotation, tampering) -- these need completely different fixes.
      request.log.info(
        {
          sentSessionCookie: Boolean(request.cookies["ccam_session"]),
          protocol: request.protocol,
          userAgent: request.headers["user-agent"],
        },
        "unauthenticated /api/auth/me"
      );
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
