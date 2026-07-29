import fp from "fastify-plugin";
import type { FastifyInstance } from "fastify";
import type { Env } from "../config/env";

export default fp(async function configPlugin(fastify: FastifyInstance, env: Env) {
  fastify.decorate("config", env);
});
