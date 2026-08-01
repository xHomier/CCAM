import path from "node:path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { loadEnv } from "./config/env";
import configPlugin from "./plugins/config";
import dbPlugin from "./plugins/db";
import sessionPlugin from "./plugins/session";
import { bootstrapAdmin } from "./modules/auth/bootstrap";
import authRoutes from "./modules/auth/routes";
import userRoutes from "./modules/users/routes";
import cameraRoutes from "./modules/cameras/routes";
import eventRoutes from "./modules/events/routes";
import recordingRoutes from "./modules/recordings/routes";
import settingsRoutes from "./modules/settings/routes";
import { CameraRuntime } from "./runtime/cameraRuntime";
import { scheduleRetentionJob } from "./recording/retentionJob";

async function main() {
  const env = loadEnv();
  // The backend is only ever reached through the nginx proxy on the internal
  // Docker network, so the forwarded headers it sets can be trusted -- and
  // must be, for request.protocol to report the client's real scheme (used to
  // decide whether the session cookie gets the Secure attribute).
  const fastify = Fastify({ logger: true, trustProxy: true });

  await fastify.register(configPlugin, env);
  await fastify.register(dbPlugin);
  await fastify.register(sessionPlugin);

  await fastify.register(fastifyStatic, {
    root: path.resolve(env.RECORDINGS_PATH),
    prefix: "/recordings/",
    decorateReply: false,
    list: false,
  });

  await bootstrapAdmin(fastify.db, env);

  const cameraRuntime = new CameraRuntime(fastify.db, env.RECORDINGS_PATH, env.GO2RTC_API_URL);
  fastify.decorate("cameraRuntime", cameraRuntime);

  await fastify.register(authRoutes);
  await fastify.register(userRoutes);
  await fastify.register(cameraRoutes);
  await fastify.register(eventRoutes);
  await fastify.register(recordingRoutes);
  await fastify.register(settingsRoutes);

  await cameraRuntime.start();
  scheduleRetentionJob(fastify.db, env.RECORDINGS_PATH, env.TZ);

  await fastify.listen({ host: "0.0.0.0", port: env.PORT });

  // Give ffmpeg a clean SIGTERM before the process exits (container restart,
  // `docker compose down`, redeploy, ...) so it finalizes its currently-open
  // segment instead of being killed mid-write and left corrupted.
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    fastify.log.info("Shutting down: stopping recorders and pollers...");
    cameraRuntime.stopAll();
    await fastify.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
