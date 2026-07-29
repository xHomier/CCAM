import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import { createDb } from "../db/client";

export default fp(async function dbPlugin(fastify: FastifyInstance) {
  const db = createDb(fastify.config.DB_PATH);
  fastify.decorate("db", db);
});
