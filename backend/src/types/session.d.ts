import type { FastifyRequest, FastifyReply } from "fastify";
import type { Session } from "../plugins/session";

declare module "fastify" {
  interface FastifyRequest {
    session: Session;
  }

  interface FastifyInstance {
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      role: "admin" | "user"
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    db: import("../db/client").Db;
    config: import("../config/env").Env;
    cameraRuntime: import("../runtime/cameraRuntime").CameraRuntime;
  }
}
