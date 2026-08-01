import crypto from "node:crypto";
import cookie from "@fastify/cookie";
import fp from "fastify-plugin";
import type { FastifyInstance, FastifyRequest } from "fastify";

const COOKIE_NAME = "ccam_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

interface SessionData {
  userId?: number;
  role?: "admin" | "user";
}

/**
 * Minimal stateless encrypted-cookie session, hand-rolled with Node's
 * built-in crypto instead of @fastify/secure-session: that package pulls in
 * sodium-native, a native addon with no musl/Alpine prebuild for recent Node
 * versions, which crash-loops the backend container. node:crypto has no such
 * portability problem (same rationale as bcryptjs over native bcrypt).
 */
export class Session {
  private data: SessionData;
  changed = false;
  private cleared = false;

  constructor(data: SessionData) {
    this.data = data;
  }

  get<K extends keyof SessionData>(key: K): SessionData[K] {
    return this.data[key];
  }

  set<K extends keyof SessionData>(key: K, value: SessionData[K]) {
    this.data[key] = value;
    this.changed = true;
  }

  delete() {
    this.data = {};
    this.cleared = true;
    this.changed = true;
  }

  get isCleared() {
    return this.cleared;
  }

  serialize(key: Buffer): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(this.data), "utf-8"),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  }
}

function deserialize(raw: string | undefined, key: Buffer): SessionData {
  if (!raw) return {};
  try {
    const buf = Buffer.from(raw, "base64url");
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString("utf-8")) as SessionData;
  } catch {
    // Tampered, expired key rotation, or garbage cookie -- treat as logged out.
    return {};
  }
}

/**
 * `secure` has to be decided per request, not hard-coded: the same backend is
 * reached both over plain HTTP on the LAN and over HTTPS through Cloudflare.
 * A Secure cookie is silently dropped by the browser on the plain-HTTP
 * entrypoint, so forcing it on would break LAN login outright -- while
 * leaving it off over HTTPS is what let Safari/WebKit treat the session
 * cookie as low-trust and evict it.
 *
 * TLS is terminated upstream (Cloudflare -> cloudflared -> nginx), so the
 * backend always sees plain HTTP on the socket; `request.protocol` reflects
 * the client's real scheme only because Fastify runs with `trustProxy` and
 * nginx forwards the original X-Forwarded-Proto.
 */
function cookieOptions(request: FastifyRequest) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: request.protocol === "https",
  };
}

export default fp(async function sessionPlugin(fastify: FastifyInstance) {
  await fastify.register(cookie);

  const key = Buffer.from(fastify.config.SESSION_KEY, "hex");

  fastify.decorateRequest("session", null as unknown as Session);

  fastify.addHook("onRequest", async (request) => {
    request.session = new Session(deserialize(request.cookies[COOKIE_NAME], key));
  });

  fastify.addHook("onSend", async (request, reply) => {
    if (!request.session?.changed) return;
    if (request.session.isCleared) {
      reply.clearCookie(COOKIE_NAME, cookieOptions(request));
    } else {
      reply.setCookie(COOKIE_NAME, request.session.serialize(key), {
        ...cookieOptions(request),
        // Without an explicit lifetime this is a *browser-session* cookie,
        // discarded whenever the browsing session ends. Desktop browsers keep
        // that session alive for days, but iOS drops it as soon as the tab is
        // evicted or the app is backgrounded -- which is why logging in
        // appeared to work on desktop and never stuck on the phone.
        maxAge: SESSION_MAX_AGE_SECONDS,
      });
    }
  });

  fastify.decorate("requireAuth", async (request, reply) => {
    if (!request.session.get("userId")) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  fastify.decorate("requireRole", (role: "admin" | "user") => {
    return async (
      request: Parameters<FastifyInstance["requireAuth"]>[0],
      reply: Parameters<FastifyInstance["requireAuth"]>[1]
    ) => {
      if (!request.session.get("userId")) {
        reply.code(401).send({ error: "Unauthorized" });
        return;
      }
      if (role === "admin" && request.session.get("role") !== "admin") {
        reply.code(403).send({ error: "Forbidden" });
      }
    };
  });
});
