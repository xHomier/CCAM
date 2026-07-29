import { loadEnv } from "../config/env";
import { createDb } from "./client";

const env = loadEnv();
createDb(env.DB_PATH);
// eslint-disable-next-line no-console
console.log(`Migrations applied to ${env.DB_PATH}`);
